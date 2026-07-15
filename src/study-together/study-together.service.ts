import { HttpStatus, Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { BadgesService } from '../badges/badges.service';
import { OUTBOX_STUDY_COMPLETED } from '../badges/badge.constants';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { RewardLedgerService } from '../gamification/reward-ledger.service';
import {
  isReadingContent,
  type UnitPlayContent,
} from '../lessons/lesson-play.types';
import { LessonContentService } from '../lessons/lesson-content.service';
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import {
  Lesson,
  LessonStatus,
} from '../roadmaps/entities/lesson.entity';
import { Roadmap, RoadmapStatus } from '../roadmaps/entities/roadmap.entity';
import { SocialPermissionService } from '../social/social-permission.service';
import { User } from '../users/entities/user.entity';
import {
  CreateStudySessionDto,
  StudyCompleteDto,
  StudyHeartbeatDto,
  StudyTaskDto,
} from './dto/study-together.dto';
import { StudySessionEvent } from './entities/study-session-event.entity';
import { StudySessionMessage } from './entities/study-session-message.entity';
import { StudySessionParticipant } from './entities/study-session-participant.entity';
import { StudySession } from './entities/study-session.entity';
import {
  STUDY_ALLOWED_DURATIONS_MIN,
  STUDY_CHAT_MESSAGE_MAX_LEN,
  STUDY_DISCONNECT_GRACE_SEC,
  STUDY_HEARTBEAT_INTERVAL_SEC,
  STUDY_INVITE_EXPIRY_NOW_MS,
  STUDY_INVITE_EXPIRY_SCHEDULED_AFTER_START_MS,
  STUDY_INVITE_EXPIRY_WITHIN_MS,
  STUDY_MAX_CONCURRENT_ROOMS,
  STUDY_MIN_VERIFIED_MINUTES,
  STUDY_PAIR_DAILY_REWARD_CAP,
  STUDY_QUALIFY_ACTIVE_RATIO,
  STUDY_SHARED_BONUS_COINS,
  STUDY_SHARED_BONUS_GEMS,
  STUDY_WEEKLY_REWARD_CAP,
  StudyCompletionOutcome,
  StudyEventType,
  StudyInvitationStatus,
  StudyParticipantRole,
  StudySessionMode,
  StudySessionStatus,
  StudyStartMode,
} from './study.constants';

const OPEN_INVITE_STATUSES = [
  StudySessionStatus.Invited,
  StudySessionStatus.Accepted,
  StudySessionStatus.Waiting,
];

const LIVE_STATUSES = [
  StudySessionStatus.Invited,
  StudySessionStatus.Accepted,
  StudySessionStatus.Waiting,
  StudySessionStatus.Active,
];

const TERMINAL_STATUSES = [
  StudySessionStatus.Completed,
  StudySessionStatus.Declined,
  StudySessionStatus.Expired,
  StudySessionStatus.Cancelled,
  StudySessionStatus.Abandoned,
  StudySessionStatus.PartiallyCompleted,
  StudySessionStatus.Voided,
];

@Injectable()
export class StudyTogetherService {
  private readonly logger = new Logger(StudyTogetherService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly socialPermissions: SocialPermissionService,
    private readonly notifications: NotificationsService,
    private readonly ledger: RewardLedgerService,
    private readonly lessonContent: LessonContentService,
    @Optional()
    @Inject(forwardRef(() => BadgesService))
    private readonly badges: BadgesService | undefined,
    @InjectRepository(StudySession)
    private readonly sessionsRepo: Repository<StudySession>,
    @InjectRepository(StudySessionParticipant)
    private readonly participantsRepo: Repository<StudySessionParticipant>,
    @InjectRepository(StudySessionEvent)
    private readonly eventsRepo: Repository<StudySessionEvent>,
    @InjectRepository(StudySessionMessage)
    private readonly messagesRepo: Repository<StudySessionMessage>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
  ) {}

  async create(userId: string, dto: CreateStudySessionDto) {
    await this.runMaintenance();

    if (
      !(STUDY_ALLOWED_DURATIONS_MIN as readonly number[]).includes(
        dto.durationMinutes,
      )
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_DURATION_INVALID,
        'Duration must be 15, 25, 45, or 60 minutes',
      );
    }

    const invitee = await this.usersRepo.findOne({
      where: { id: dto.inviteeId },
    });
    if (!invitee) {
      throw new AppException(
        AuthErrorCode.SOCIAL_USER_NOT_FOUND,
        'Invitee not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const gate = await this.socialPermissions.canStudyInvite(
      userId,
      dto.inviteeId,
    );
    if (!gate.allowed) {
      throw new AppException(
        AuthErrorCode.STUDY_INVITE_NOT_ALLOWED,
        'Study invite not allowed',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.assertRoomCap(userId);
    await this.assertRoomCap(dto.inviteeId);

    const now = new Date();
    let scheduledStartAt: Date | null = null;
    let scheduledEndAt: Date | null = null;
    let inviteExpiresAt: Date;

    if (dto.startMode === StudyStartMode.Now) {
      inviteExpiresAt = new Date(now.getTime() + STUDY_INVITE_EXPIRY_NOW_MS);
    } else if (dto.startMode === StudyStartMode.Within1Hour) {
      scheduledStartAt = new Date(now.getTime() + 60 * 60 * 1000);
      scheduledEndAt = new Date(
        scheduledStartAt.getTime() + dto.durationMinutes * 60_000,
      );
      inviteExpiresAt = new Date(
        now.getTime() + STUDY_INVITE_EXPIRY_WITHIN_MS,
      );
    } else {
      if (!dto.scheduledStartAt) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'scheduledStartAt required for scheduled start',
        );
      }
      scheduledStartAt = new Date(dto.scheduledStartAt);
      if (scheduledStartAt.getTime() <= now.getTime()) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'scheduledStartAt must be in the future',
        );
      }
      scheduledEndAt = new Date(
        scheduledStartAt.getTime() + dto.durationMinutes * 60_000,
      );
      inviteExpiresAt = new Date(
        scheduledStartAt.getTime() +
          STUDY_INVITE_EXPIRY_SCHEDULED_AFTER_START_MS,
      );
    }

    const message = dto.message?.trim() ? dto.message.trim() : null;
    const lessonMeta = await this.resolveCreatorLesson(userId, dto.lessonId);

    const session = await this.dataSource.transaction(async (manager) => {
      const row = manager.create(StudySession, {
        creatorId: userId,
        inviteeId: dto.inviteeId,
        subject: dto.subject,
        lessonId: lessonMeta.lessonId,
        unitId: lessonMeta.unitId,
        lessonTitle: lessonMeta.lessonTitle,
        mode: StudySessionMode.ReadTogether,
        contentStep: 0,
        stepCount: lessonMeta.stepCount,
        durationMinutes: dto.durationMinutes,
        startMode: dto.startMode,
        message,
        status: StudySessionStatus.Invited,
        scheduledStartAt,
        scheduledEndAt,
        inviteExpiresAt,
        completionOutcome: StudyCompletionOutcome.None,
      });
      const saved = await manager.save(row);

      await manager.save([
        manager.create(StudySessionParticipant, {
          sessionId: saved.id,
          userId,
          role: StudyParticipantRole.Creator,
          invitationStatus: StudyInvitationStatus.Accepted,
          joinedAt: now,
          taskLabel: lessonMeta.lessonTitle,
          ackedStep: -1,
        }),
        manager.create(StudySessionParticipant, {
          sessionId: saved.id,
          userId: dto.inviteeId,
          role: StudyParticipantRole.Invitee,
          invitationStatus: StudyInvitationStatus.Pending,
          taskLabel: lessonMeta.lessonTitle,
          ackedStep: -1,
        }),
      ]);

      await this.appendEvent(manager, {
        sessionId: saved.id,
        userId,
        type: StudyEventType.InviteSent,
        payload: {
          subject: dto.subject,
          durationMinutes: dto.durationMinutes,
          startMode: dto.startMode,
        },
      });

      return saved;
    });

    const creatorName = await this.displayName(userId);
    await this.notifications.create({
      userId: dto.inviteeId,
      type: NotificationType.StudyInvite,
      title: 'Study Together invite',
      body: `${creatorName} invited you to read "${lessonMeta.lessonTitle}" together for ${dto.durationMinutes} minutes.`,
      actionUrl: `/study/room?id=${session.id}`,
      payload: { sessionId: session.id },
      dedupeKey: `study_invite:${session.id}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });

    return this.getState(userId, session.id);
  }

  async listRooms(userId: string) {
    await this.runMaintenance();
    const sessions = await this.sessionsRepo.find({
      where: [
        { creatorId: userId, status: In(LIVE_STATUSES) },
        { inviteeId: userId, status: In(LIVE_STATUSES) },
      ],
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return {
      items: await Promise.all(
        sessions.map((s) => this.getState(userId, s.id)),
      ),
    };
  }

  async listInvites(userId: string) {
    await this.runMaintenance();
    const sessions = await this.sessionsRepo.find({
      where: [
        { inviteeId: userId, status: StudySessionStatus.Invited },
        { creatorId: userId, status: StudySessionStatus.Invited },
        { inviteeId: userId, status: StudySessionStatus.Accepted },
        { creatorId: userId, status: StudySessionStatus.Accepted },
        { inviteeId: userId, status: StudySessionStatus.Waiting },
        { creatorId: userId, status: StudySessionStatus.Waiting },
        { inviteeId: userId, status: StudySessionStatus.Active },
        { creatorId: userId, status: StudySessionStatus.Active },
      ],
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return {
      items: await Promise.all(
        sessions.map((s) => this.getState(userId, s.id)),
      ),
    };
  }

  async accept(userId: string, sessionId: string) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (session.inviteeId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Only invitee can accept',
        HttpStatus.FORBIDDEN,
      );
    }
    if (session.status !== StudySessionStatus.Invited) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Invite is not open',
      );
    }
    this.assertInviteFresh(session);

    await this.dataSource.transaction(async (manager) => {
      session.status =
        session.startMode === StudyStartMode.Now
          ? StudySessionStatus.Waiting
          : StudySessionStatus.Accepted;
      await manager.save(session);

      const invitee = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      invitee.invitationStatus = StudyInvitationStatus.Accepted;
      invitee.joinedAt = new Date();
      await manager.save(invitee);

      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.Accepted,
      });
    });

    const inviteeName = await this.displayName(userId);
    await this.notifications.create({
      userId: session.creatorId,
      type: NotificationType.StudyInviteAccepted,
      title: 'Study invite accepted',
      body: `${inviteeName} accepted your Study Together invite.`,
      actionUrl: `/study/room?id=${sessionId}`,
      payload: { sessionId },
      dedupeKey: `study_accepted:${sessionId}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });

    return this.getState(userId, sessionId);
  }

  async decline(userId: string, sessionId: string) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (session.inviteeId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Only invitee can decline',
        HttpStatus.FORBIDDEN,
      );
    }
    if (session.status !== StudySessionStatus.Invited) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Invite is not open',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      session.status = StudySessionStatus.Declined;
      session.actualEndAt = new Date();
      await manager.save(session);

      const invitee = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      invitee.invitationStatus = StudyInvitationStatus.Declined;
      await manager.save(invitee);

      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.Declined,
      });
    });

    return this.getState(userId, sessionId);
  }

  async cancel(userId: string, sessionId: string) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (session.creatorId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Only creator can cancel',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      ![
        StudySessionStatus.Invited,
        StudySessionStatus.Accepted,
        StudySessionStatus.Waiting,
      ].includes(session.status)
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session cannot be cancelled now',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      session.status = StudySessionStatus.Cancelled;
      session.actualEndAt = new Date();
      await manager.save(session);

      await manager.update(
        StudySessionParticipant,
        { sessionId },
        { invitationStatus: StudyInvitationStatus.Cancelled },
      );

      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.Cancelled,
      });
    });

    return this.getState(userId, sessionId);
  }

  async setTask(userId: string, sessionId: string, dto: StudyTaskDto) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (TERMINAL_STATUSES.includes(session.status)) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session already ended',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const p = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      if (dto.taskId !== undefined) p.taskId = dto.taskId;
      if (dto.taskLabel !== undefined) p.taskLabel = dto.taskLabel;
      if (dto.meaningfulAction) p.meaningfulActionCompleted = true;
      await manager.save(p);

      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: dto.meaningfulAction
          ? StudyEventType.MeaningfulAction
          : StudyEventType.TaskChanged,
        payload: {
          taskId: p.taskId,
          taskLabel: p.taskLabel,
          meaningfulAction: !!dto.meaningfulAction,
        },
      });
      session.roomVersion += 1;
      await manager.save(session);
    });

    return this.getState(userId, sessionId);
  }

  async ready(userId: string, sessionId: string) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (
      ![
        StudySessionStatus.Accepted,
        StudySessionStatus.Waiting,
        StudySessionStatus.Active,
      ].includes(session.status)
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session not ready for ready signal',
      );
    }

    const now = new Date();
    let started = false;

    await this.dataSource.transaction(async (manager) => {
      const me = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      if (!me.readyAt) {
        me.readyAt = now;
        if (!me.joinedAt) me.joinedAt = now;
        await manager.save(me);
        await this.appendEvent(manager, {
          sessionId,
          userId,
          type: StudyEventType.Ready,
        });
      }

      const all = await manager.find(StudySessionParticipant, {
        where: { sessionId },
      });
      const bothReady = all.every((p) => !!p.readyAt);

      if (
        bothReady &&
        session.status !== StudySessionStatus.Active &&
        (session.startMode === StudyStartMode.Now ||
          !session.scheduledStartAt ||
          session.scheduledStartAt.getTime() <= now.getTime())
      ) {
        session.status = StudySessionStatus.Active;
        session.actualStartAt = now;
        session.plannedEndAt = new Date(
          now.getTime() + session.durationMinutes * 60_000,
        );
        session.roomVersion += 1;
        await manager.save(session);
        await this.appendEvent(manager, {
          sessionId,
          userId: null,
          type: StudyEventType.TimerStarted,
          payload: {
            actualStartAt: now.toISOString(),
            plannedEndAt: session.plannedEndAt.toISOString(),
          },
        });
        started = true;
      } else if (
        bothReady &&
        session.status === StudySessionStatus.Accepted
      ) {
        session.status = StudySessionStatus.Waiting;
        session.roomVersion += 1;
        await manager.save(session);
      }
    });

    const partnerId =
      session.creatorId === userId ? session.inviteeId : session.creatorId;
    const myName = await this.displayName(userId);

    if (started) {
      await this.notifications.create({
        userId: partnerId,
        type: NotificationType.StudySessionStarting,
        title: 'Focus room started',
        body: `Your Study Together session for ${session.subject} is live.`,
        actionUrl: `/study/room?id=${sessionId}`,
        payload: { sessionId },
        dedupeKey: `study_starting:${sessionId}`,
        channels: [NotificationChannel.InApp, NotificationChannel.Push],
      });
    } else {
      await this.notifications.create({
        userId: partnerId,
        type: NotificationType.StudyPartnerReady,
        title: 'Study partner ready',
        body: `${myName} is ready to study.`,
        actionUrl: `/study/room?id=${sessionId}`,
        payload: { sessionId },
        dedupeKey: `study_ready:${sessionId}:${userId}`,
        channels: [NotificationChannel.InApp, NotificationChannel.Push],
      });
    }

    return this.getState(userId, sessionId);
  }

  async heartbeat(
    userId: string,
    sessionId: string,
    dto: StudyHeartbeatDto = {},
  ) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (session.status !== StudySessionStatus.Active) {
      return this.getState(userId, sessionId);
    }

    const now = new Date();
    const appVisible = dto.appVisible !== false;
    const focusActive = dto.focusActive !== false;

    await this.dataSource.transaction(async (manager) => {
      const p = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      p.appVisible = appVisible;
      p.heartbeatCount += 1;

      let delta = 0;
      if (appVisible && focusActive && !p.leftAt) {
        if (p.lastHeartbeatAt) {
          const gapSec = Math.floor(
            (now.getTime() - p.lastHeartbeatAt.getTime()) / 1000,
          );
          if (gapSec > 0 && gapSec <= STUDY_DISCONNECT_GRACE_SEC) {
            delta = Math.min(gapSec, STUDY_HEARTBEAT_INTERVAL_SEC + 5);
          } else if (gapSec > 0 && gapSec <= STUDY_HEARTBEAT_INTERVAL_SEC + 5) {
            delta = gapSec;
          }
        } else {
          delta = STUDY_HEARTBEAT_INTERVAL_SEC;
        }
        p.verifiedActiveSeconds += delta;
      }
      p.lastHeartbeatAt = now;
      await manager.save(p);
    });

    // Auto-complete when timer elapsed
    if (
      session.plannedEndAt &&
      session.plannedEndAt.getTime() <= now.getTime()
    ) {
      return this.finalizeIfDue(userId, sessionId);
    }

    return this.getState(userId, sessionId);
  }

  async leave(userId: string, sessionId: string) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (TERMINAL_STATUSES.includes(session.status)) {
      return this.getState(userId, sessionId);
    }

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const p = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      p.leftAt = now;
      await manager.save(p);
      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.Left,
      });

      if (
        [
          StudySessionStatus.Invited,
          StudySessionStatus.Accepted,
          StudySessionStatus.Waiting,
        ].includes(session.status)
      ) {
        session.status = StudySessionStatus.Abandoned;
        session.actualEndAt = now;
        session.completionOutcome = StudyCompletionOutcome.Abandoned;
        await manager.save(session);
      }
    });

    if (session.status === StudySessionStatus.Active) {
      return this.tryComplete(userId, sessionId, {
        meaningfulAction: false,
      });
    }

    return this.getState(userId, sessionId);
  }

  async complete(
    userId: string,
    sessionId: string,
    dto: StudyCompleteDto = {},
  ) {
    return this.tryComplete(userId, sessionId, dto);
  }

  async getContent(userId: string, sessionId: string) {
    const session = await this.requireParticipantSession(userId, sessionId);
    if (!session.lessonId) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Session has no lesson bound',
      );
    }

    const lesson = await this.lessonsRepo.findOne({
      where: { id: session.lessonId },
    });
    if (!lesson) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Lesson not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const content = await this.lessonContent.ensurePlayContent(lesson);
    if (!isReadingContent(content)) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Lesson is not a reading session',
      );
    }

    return {
      sessionId: session.id,
      lessonId: session.lessonId,
      lessonTitle: session.lessonTitle ?? lesson.title,
      contentStep: session.contentStep,
      stepCount: session.stepCount,
      body: this.lessonContent.toPublicPlayBody(content),
    };
  }

  async ackRead(
    userId: string,
    sessionId: string,
    opts: { soloAdvance?: boolean } = {},
  ) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);
    if (
      ![
        StudySessionStatus.Waiting,
        StudySessionStatus.Active,
        StudySessionStatus.Accepted,
      ].includes(session.status)
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session not in reading state',
      );
    }

    let stepPayload: {
      contentStep: number;
      stepCount: number;
      acks: { userId: string; ackedStep: number }[];
      advanced: boolean;
      readingComplete: boolean;
    } | null = null;

    await this.dataSource.transaction(async (manager) => {
      const me = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });

      if (me.ackedStep >= session.contentStep) {
        const refreshedEarly = await manager.find(StudySessionParticipant, {
          where: { sessionId },
        });
        const partnerEarly = refreshedEarly.find((p) => p.userId !== userId)!;
        const allowSoloRetry =
          opts.soloAdvance &&
          session.creatorId === userId &&
          this.isPartnerDisconnected(partnerEarly);
        if (!allowSoloRetry) {
          return;
        }
      } else {
        me.ackedStep = session.contentStep;
        await manager.save(me);

        await this.appendEvent(manager, {
          sessionId,
          userId,
          type: StudyEventType.StepAcked,
          payload: { contentStep: session.contentStep },
        });
      }

      const refreshed = await manager.find(StudySessionParticipant, {
        where: { sessionId },
      });
      const partner = refreshed.find((p) => p.userId !== userId)!;
      const partnerDisconnected = this.isPartnerDisconnected(partner);
      const bothAcked = refreshed.every(
        (p) => p.ackedStep >= session.contentStep,
      );
      const canSoloAdvance =
        opts.soloAdvance &&
        session.creatorId === userId &&
        partnerDisconnected &&
        me.ackedStep >= session.contentStep;

      if (!bothAcked && !canSoloAdvance) {
        stepPayload = {
          contentStep: session.contentStep,
          stepCount: session.stepCount,
          acks: refreshed.map((p) => ({
            userId: p.userId,
            ackedStep: p.ackedStep,
          })),
          advanced: false,
          readingComplete: false,
        };
        return;
      }

      const isLastStep = session.contentStep >= session.stepCount - 1;
      if (isLastStep) {
        for (const p of refreshed) {
          p.meaningfulActionCompleted = true;
          await manager.save(p);
        }
        session.roomVersion += 1;
        await manager.save(session);
        await this.appendEvent(manager, {
          sessionId,
          userId: null,
          type: StudyEventType.MeaningfulAction,
          payload: { contentStep: session.contentStep, final: true },
        });
        stepPayload = {
          contentStep: session.contentStep,
          stepCount: session.stepCount,
          acks: refreshed.map((p) => ({
            userId: p.userId,
            ackedStep: p.ackedStep,
          })),
          advanced: false,
          readingComplete: true,
        };
        return;
      }

      session.contentStep += 1;
      session.roomVersion += 1;
      await manager.save(session);
      await this.appendEvent(manager, {
        sessionId,
        userId: null,
        type: StudyEventType.StepAdvanced,
        payload: {
          contentStep: session.contentStep,
          soloAdvance: canSoloAdvance,
        },
      });

      const afterAdvance = await manager.find(StudySessionParticipant, {
        where: { sessionId },
      });
      stepPayload = {
        contentStep: session.contentStep,
        stepCount: session.stepCount,
        acks: afterAdvance.map((p) => ({
          userId: p.userId,
          ackedStep: p.ackedStep,
        })),
        advanced: true,
        readingComplete: false,
      };
    });

    const state = await this.getState(userId, sessionId);
    return { state, step: stepPayload };
  }

  async listMessages(
    userId: string,
    sessionId: string,
    cursor?: string,
    limit = 40,
  ) {
    await this.requireParticipantSession(userId, sessionId);
    const take = Math.min(Math.max(limit, 1), 100);
    const qb = this.messagesRepo
      .createQueryBuilder('m')
      .where('m.session_id = :sessionId', { sessionId })
      .orderBy('m.created_at', 'DESC')
      .take(take + 1);

    if (cursor) {
      const cursorRow = await this.messagesRepo.findOne({
        where: { id: cursor, sessionId },
      });
      if (cursorRow) {
        qb.andWhere('m.created_at < :createdAt', {
          createdAt: cursorRow.createdAt,
        });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const senderIds = [...new Set(page.map((m) => m.senderId))];
    const profiles = senderIds.length
      ? await this.profilesRepo.find({ where: { userId: In(senderIds) } })
      : [];
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const items = page.reverse().map((m) => {
      const profile = profileMap.get(m.senderId);
      const name =
        profile?.displayName || profile?.username || 'Learner';
      return {
        id: m.id,
        sessionId: m.sessionId,
        senderId: m.senderId,
        senderName: name,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      };
    });

    return {
      items,
      nextCursor: hasMore ? page[0]?.id ?? null : null,
    };
  }

  async sendChatMessage(userId: string, sessionId: string, rawBody: string) {
    const session = await this.requireParticipantSession(userId, sessionId);
    if (TERMINAL_STATUSES.includes(session.status)) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session already ended',
      );
    }

    const body = rawBody.trim();
    if (!body || body.length > STUDY_CHAT_MESSAGE_MAX_LEN) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Invalid chat message',
      );
    }

    const recent = await this.messagesRepo.count({
      where: {
        sessionId,
        senderId: userId,
        createdAt: MoreThan(new Date(Date.now() - 10_000)),
      },
    });
    if (recent >= 8) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Chat rate limit exceeded',
      );
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const row = manager.create(StudySessionMessage, {
        sessionId,
        senderId: userId,
        body,
      });
      const msg = await manager.save(row);
      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.ChatMessage,
        payload: { messageId: msg.id },
      });
      session.roomVersion += 1;
      await manager.save(session);
      return msg;
    });

    const profile = await this.profilesRepo.findOne({ where: { userId } });
    const senderName =
      profile?.displayName || profile?.username || 'Learner';

    return {
      id: saved.id,
      sessionId: saved.sessionId,
      senderId: saved.senderId,
      senderName,
      body: saved.body,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async setTyping(userId: string, sessionId: string) {
    await this.requireParticipantSession(userId, sessionId);
    await this.participantsRepo.update(
      { sessionId, userId },
      { typingAt: new Date() },
    );
  }

  async requireParticipant(userId: string, sessionId: string) {
    await this.requireParticipantSession(userId, sessionId);
  }

  async getState(userId: string, sessionId: string) {
    const session = await this.requireParticipantSession(userId, sessionId);
    const participants = await this.participantsRepo.find({
      where: { sessionId },
    });
    const ids = [session.creatorId, session.inviteeId];
    const profiles = await this.profilesRepo.find({
      where: { userId: In(ids) },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));

    const now = Date.now();
    let remainingSeconds: number | null = null;
    if (
      session.status === StudySessionStatus.Active &&
      session.plannedEndAt
    ) {
      remainingSeconds = Math.max(
        0,
        Math.floor((session.plannedEndAt.getTime() - now) / 1000),
      );
    }

    const you = participants.find((p) => p.userId === userId)!;
    const them = participants.find((p) => p.userId !== userId)!;
    const partnerId = them.userId;
    const partnerProfile = profileMap.get(partnerId);
    const yourProfile = profileMap.get(userId);

    const plannedSec = session.durationMinutes * 60;
    const qualifyThreshold = Math.ceil(
      plannedSec * STUDY_QUALIFY_ACTIVE_RATIO,
    );

    return {
      id: session.id,
      status: session.status,
      mode: session.mode,
      subject: session.subject,
      lessonId: session.lessonId,
      lessonTitle: session.lessonTitle,
      contentStep: session.contentStep,
      stepCount: session.stepCount,
      durationMinutes: session.durationMinutes,
      startMode: session.startMode,
      message: session.message,
      scheduledStartAt: session.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: session.scheduledEndAt?.toISOString() ?? null,
      inviteExpiresAt: session.inviteExpiresAt?.toISOString() ?? null,
      actualStartAt: session.actualStartAt?.toISOString() ?? null,
      actualEndAt: session.actualEndAt?.toISOString() ?? null,
      plannedEndAt: session.plannedEndAt?.toISOString() ?? null,
      remainingSeconds,
      roomVersion: session.roomVersion,
      completionOutcome: session.completionOutcome,
      sharedBonusGranted: session.sharedBonusGranted,
      sharedBonus: session.sharedBonusGranted
        ? {
            coins: STUDY_SHARED_BONUS_COINS,
            gems: STUDY_SHARED_BONUS_GEMS,
          }
        : null,
      role:
        session.creatorId === userId
          ? StudyParticipantRole.Creator
          : StudyParticipantRole.Invitee,
      you: this.serializeParticipant(you, yourProfile, qualifyThreshold),
      partner: this.serializeParticipant(
        them,
        partnerProfile,
        qualifyThreshold,
      ),
      serverNow: new Date(now).toISOString(),
      createdAt: session.createdAt.toISOString(),
    };
  }

  async history(userId: string, cursor?: string, limit = 20) {
    await this.runMaintenance();
    const take = Math.min(Math.max(limit, 1), 50);
    const qb = this.sessionsRepo
      .createQueryBuilder('s')
      .where('(s.creator_id = :userId OR s.invitee_id = :userId)', { userId })
      .andWhere('s.status IN (:...statuses)', {
        statuses: [
          StudySessionStatus.Completed,
          StudySessionStatus.PartiallyCompleted,
          StudySessionStatus.Abandoned,
          StudySessionStatus.Declined,
          StudySessionStatus.Cancelled,
          StudySessionStatus.Expired,
          StudySessionStatus.Voided,
        ],
      })
      .orderBy('s.created_at', 'DESC')
      .take(take + 1);

    if (cursor) {
      const cursorRow = await this.sessionsRepo.findOne({
        where: { id: cursor },
      });
      if (cursorRow) {
        qb.andWhere('s.created_at < :createdAt', {
          createdAt: cursorRow.createdAt,
        });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = await Promise.all(
      page.map((s) => this.getState(userId, s.id)),
    );
    return {
      items,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // ── internals ──────────────────────────────────────────────

  private async tryComplete(
    userId: string,
    sessionId: string,
    dto: StudyCompleteDto,
  ) {
    await this.runMaintenance();
    const session = await this.requireParticipantSession(userId, sessionId);

    if (
      ![
        StudySessionStatus.Active,
        StudySessionStatus.Waiting,
        StudySessionStatus.Accepted,
      ].includes(session.status)
    ) {
      if (TERMINAL_STATUSES.includes(session.status)) {
        return this.getState(userId, sessionId);
      }
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session cannot be completed now',
      );
    }

    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const me = await manager.findOneOrFail(StudySessionParticipant, {
        where: { sessionId, userId },
      });
      me.completionConfirmed = true;
      if (dto.meaningfulAction) me.meaningfulActionCompleted = true;
      await manager.save(me);

      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.Completed,
        payload: { meaningfulAction: !!dto.meaningfulAction },
      });
    });

    return this.finalizeIfDue(userId, sessionId, true);
  }

  private async finalizeIfDue(
    userId: string,
    sessionId: string,
    force = false,
  ) {
    const session = await this.sessionsRepo.findOneOrFail({
      where: { id: sessionId },
    });
    if (TERMINAL_STATUSES.includes(session.status)) {
      return this.getState(userId, sessionId);
    }

    const participants = await this.participantsRepo.find({
      where: { sessionId },
    });
    const now = new Date();
    const timerDone =
      !!session.plannedEndAt && session.plannedEndAt.getTime() <= now.getTime();
    const bothConfirmed = participants.every((p) => p.completionConfirmed);
    const anyoneLeft = participants.some((p) => !!p.leftAt);

    if (!force && !timerDone && !bothConfirmed && !anyoneLeft) {
      return this.getState(userId, sessionId);
    }

    if (session.status !== StudySessionStatus.Active && !anyoneLeft) {
      // Waiting/accepted early complete → abandon
      session.status = StudySessionStatus.Abandoned;
      session.actualEndAt = now;
      session.completionOutcome = StudyCompletionOutcome.Abandoned;
      await this.sessionsRepo.save(session);
      return this.getState(userId, sessionId);
    }

    const plannedSec = session.durationMinutes * 60;
    const qualifyThreshold = Math.ceil(
      plannedSec * STUDY_QUALIFY_ACTIVE_RATIO,
    );
    const minVerified = STUDY_MIN_VERIFIED_MINUTES * 60;

    for (const p of participants) {
      const activeEnough = p.verifiedActiveSeconds >= qualifyThreshold;
      const meaningful =
        p.meaningfulActionCompleted ||
        p.verifiedActiveSeconds >= minVerified;
      p.qualified = activeEnough && meaningful && !this.abandonedEarly(p, plannedSec);
      p.rewardEligible = p.qualified;
      await this.participantsRepo.save(p);
    }

    const creator = participants.find(
      (p) => p.role === StudyParticipantRole.Creator,
    )!;
    const invitee = participants.find(
      (p) => p.role === StudyParticipantRole.Invitee,
    )!;

    let outcome: StudyCompletionOutcome;
    if (creator.qualified && invitee.qualified) {
      outcome = StudyCompletionOutcome.CompletedByBoth;
    } else if (creator.qualified) {
      outcome = StudyCompletionOutcome.CompletedByCreatorOnly;
    } else if (invitee.qualified) {
      outcome = StudyCompletionOutcome.CompletedByInviteeOnly;
    } else if (anyoneLeft) {
      outcome = StudyCompletionOutcome.Abandoned;
    } else {
      outcome = StudyCompletionOutcome.Abandoned;
    }

    session.completionOutcome = outcome;
    session.actualEndAt = now;
    session.status =
      outcome === StudyCompletionOutcome.CompletedByBoth
        ? StudySessionStatus.Completed
        : creator.qualified || invitee.qualified
          ? StudySessionStatus.PartiallyCompleted
          : StudySessionStatus.Abandoned;
    session.roomVersion += 1;
    await this.sessionsRepo.save(session);

    let sharedGranted = false;
    if (outcome === StudyCompletionOutcome.CompletedByBoth) {
      sharedGranted = await this.tryGrantSharedBonus(session, participants);
    }

    for (const p of participants) {
      if (!p.qualified) continue;
      const partnerId =
        p.userId === session.creatorId ? session.inviteeId : session.creatorId;
      await this.badges?.onDomainEvent({
        type: OUTBOX_STUDY_COMPLETED,
        payload: {
          userId: p.userId,
          partnerId,
          sessionId: session.id,
        },
      });
    }

    const partnerId =
      session.creatorId === userId ? session.inviteeId : session.creatorId;

    if (sharedGranted) {
      for (const uid of [session.creatorId, session.inviteeId]) {
        await this.notifications.create({
          userId: uid,
          type: NotificationType.StudySessionCompleted,
          title: 'Shared bonus unlocked',
          body: `Both of you focused for ${session.durationMinutes} minutes — +${STUDY_SHARED_BONUS_COINS} coins · +${STUDY_SHARED_BONUS_GEMS} gems.`,
          actionUrl: `/study/room?id=${sessionId}`,
          payload: { sessionId, sharedBonus: true },
          dedupeKey: `study_completed:${sessionId}:${uid}`,
          channels: [NotificationChannel.InApp, NotificationChannel.Push],
        });
      }
    } else if (
      outcome === StudyCompletionOutcome.CompletedByCreatorOnly ||
      outcome === StudyCompletionOutcome.CompletedByInviteeOnly
    ) {
      const missedId =
        outcome === StudyCompletionOutcome.CompletedByCreatorOnly
          ? session.inviteeId
          : session.creatorId;
      await this.notifications.create({
        userId: missedId,
        type: NotificationType.StudySessionMissed,
        title: 'Session wrapped',
        body: 'Your partner finished — no shared bonus this time. Want to reschedule?',
        actionUrl: `/study/invite?friend=${partnerId}`,
        payload: { sessionId },
        dedupeKey: `study_missed:${sessionId}:${missedId}`,
        channels: [NotificationChannel.InApp],
      });
    }

    return this.getState(userId, sessionId);
  }

  private abandonedEarly(
    p: StudySessionParticipant,
    plannedSec: number,
  ): boolean {
    if (!p.leftAt) return false;
    return p.verifiedActiveSeconds < plannedSec * STUDY_QUALIFY_ACTIVE_RATIO;
  }

  private async tryGrantSharedBonus(
    session: StudySession,
    participants: StudySessionParticipant[],
  ): Promise<boolean> {
    if (session.sharedBonusGranted) return true;

    const weekStart = startOfUtcWeek(new Date());
    const dayStart = startOfUtcDay(new Date());

    const creatorWeekly = await this.countRewardedSessionsSince(
      session.creatorId,
      weekStart,
    );
    const inviteeWeekly = await this.countRewardedSessionsSince(
      session.inviteeId,
      weekStart,
    );
    if (
      creatorWeekly >= STUDY_WEEKLY_REWARD_CAP ||
      inviteeWeekly >= STUDY_WEEKLY_REWARD_CAP
    ) {
      this.logger.log(
        `Study shared bonus skipped (weekly cap) session=${session.id}`,
      );
      return false;
    }

    const pairDaily = await this.countPairRewardedSince(
      session.creatorId,
      session.inviteeId,
      dayStart,
    );
    if (pairDaily >= STUDY_PAIR_DAILY_REWARD_CAP) {
      this.logger.log(
        `Study shared bonus skipped (pair daily cap) session=${session.id}`,
      );
      return false;
    }

    const group = `study:${session.id}`;
    try {
      await this.dataSource.transaction(async (manager) => {
        for (const p of participants) {
          await this.ledger.grantReward(manager, {
            userId: p.userId,
            reasonType: RewardReasonType.StudyTogether,
            reasonId: session.id,
            idempotencyKey: `study:${session.id}:${p.userId}:shared`,
            lines: [
              {
                currency: RewardCurrency.Coins,
                amount: STUDY_SHARED_BONUS_COINS,
                idempotencySuffix: 'coins',
              },
              {
                currency: RewardCurrency.Gems,
                amount: STUDY_SHARED_BONUS_GEMS,
                idempotencySuffix: 'gems',
              },
            ],
            metadata: {
              sessionId: session.id,
              countsForLeague: false,
            },
          });
        }
        session.sharedBonusGranted = true;
        session.rewardTransactionGroup = group;
        await manager.save(session);
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `Study shared bonus failed session=${session.id}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  private async countRewardedSessionsSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.sessionsRepo
      .createQueryBuilder('s')
      .where('(s.creator_id = :userId OR s.invitee_id = :userId)', { userId })
      .andWhere('s.shared_bonus_granted = true')
      .andWhere('s.actual_end_at >= :since', { since })
      .getCount();
  }

  private async countPairRewardedSince(
    a: string,
    b: string,
    since: Date,
  ): Promise<number> {
    return this.sessionsRepo
      .createQueryBuilder('s')
      .where(
        '((s.creator_id = :a AND s.invitee_id = :b) OR (s.creator_id = :b AND s.invitee_id = :a))',
        { a, b },
      )
      .andWhere('s.shared_bonus_granted = true')
      .andWhere('s.actual_end_at >= :since', { since })
      .getCount();
  }

  private async assertRoomCap(userId: string) {
    const count = await this.sessionsRepo.count({
      where: [
        { creatorId: userId, status: In(LIVE_STATUSES) },
        { inviteeId: userId, status: In(LIVE_STATUSES) },
      ],
    });
    if (count >= STUDY_MAX_CONCURRENT_ROOMS) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_CONFLICT,
        'Too many live Study Together rooms',
      );
    }
  }

  private async resolveCreatorLesson(userId: string, lessonId: string) {
    const roadmaps = await this.roadmapsRepo.find({
      where: { userId, status: RoadmapStatus.Ready },
      relations: {
        phases: {
          milestones: {
            lessons: true,
          },
        },
      },
      order: { updatedAt: 'DESC' },
      take: 1,
    });
    const roadmap = roadmaps[0];
    if (!roadmap) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'No active roadmap',
      );
    }

    let lesson: Lesson | null = null;
    for (const phase of roadmap.phases ?? []) {
      for (const milestone of phase.milestones ?? []) {
        const hit = (milestone.lessons ?? []).find((l) => l.id === lessonId);
        if (hit) {
          lesson = hit;
          break;
        }
      }
      if (lesson) break;
    }

    if (!lesson) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Lesson not on your path',
        HttpStatus.NOT_FOUND,
      );
    }

    if (lesson.status === LessonStatus.Locked) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Lesson is locked',
      );
    }

    if (lesson.lessonType !== 'reading') {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Only reading lessons can be shared',
      );
    }

    const content = await this.lessonContent.ensurePlayContent(lesson);
    if (!isReadingContent(content)) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Lesson content is not reading',
      );
    }

    return {
      lessonId: lesson.id,
      unitId: lesson.unitId,
      lessonTitle: lesson.title,
      stepCount: this.computeStepCount(content),
    };
  }

  private computeStepCount(content: UnitPlayContent): number {
    if (!isReadingContent(content)) return 1;
    const sections = content.sections?.length ?? 0;
    const hasTakeaways = (content.keyTakeaways?.length ?? 0) > 0;
    return Math.max(sections + (hasTakeaways ? 1 : 0), 1);
  }

  private isPartnerDisconnected(partner: StudySessionParticipant): boolean {
    if (partner.leftAt) return true;
    if (!partner.lastHeartbeatAt) return false;
    const gapSec = Math.floor(
      (Date.now() - partner.lastHeartbeatAt.getTime()) / 1000,
    );
    return gapSec > STUDY_DISCONNECT_GRACE_SEC;
  }

  private assertInviteFresh(session: StudySession) {
    if (
      session.inviteExpiresAt &&
      session.inviteExpiresAt.getTime() < Date.now()
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_INVITE_EXPIRED,
        'Invite expired',
      );
    }
  }

  private async requireParticipantSession(userId: string, sessionId: string) {
    const session = await this.sessionsRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_FOUND,
        'Session not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (session.creatorId !== userId && session.inviteeId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Not a participant',
        HttpStatus.FORBIDDEN,
      );
    }
    return session;
  }

  private async appendEvent(
    manager: EntityManager,
    input: {
      sessionId: string;
      userId: string | null;
      type: StudyEventType;
      payload?: Record<string, unknown>;
    },
  ) {
    await manager.save(
      manager.create(StudySessionEvent, {
        sessionId: input.sessionId,
        userId: input.userId,
        type: input.type,
        payload: input.payload ?? null,
      }),
    );
  }

  private serializeParticipant(
    p: StudySessionParticipant,
    profile: Profile | undefined,
    qualifyThreshold: number,
  ) {
    const name =
      profile?.displayName || profile?.username || 'Learner';
    const initial = name.charAt(0).toUpperCase();
    return {
      userId: p.userId,
      role: p.role,
      name,
      initial,
      invitationStatus: p.invitationStatus,
      taskId: p.taskId,
      taskLabel: p.taskLabel,
      ackedStep: p.ackedStep,
      typingAt: p.typingAt?.toISOString() ?? null,
      ready: !!p.readyAt,
      joinedAt: p.joinedAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
      verifiedActiveSeconds: p.verifiedActiveSeconds,
      heartbeatCount: p.heartbeatCount,
      lastHeartbeatAt: p.lastHeartbeatAt?.toISOString() ?? null,
      appVisible: p.appVisible,
      meaningfulActionCompleted: p.meaningfulActionCompleted,
      completionConfirmed: p.completionConfirmed,
      qualified: p.qualified,
      progressHint: Math.min(
        10,
        Math.round((p.verifiedActiveSeconds / Math.max(qualifyThreshold, 1)) * 10),
      ),
    };
  }

  private async displayName(userId: string): Promise<string> {
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    return profile?.displayName || profile?.username || 'Someone';
  }

  private async runMaintenance() {
    const now = new Date();
    const expired = await this.sessionsRepo.find({
      where: {
        status: In(OPEN_INVITE_STATUSES),
        inviteExpiresAt: LessThan(now),
      },
      take: 40,
    });
    for (const s of expired) {
      s.status = StudySessionStatus.Expired;
      s.actualEndAt = now;
      s.completionOutcome = StudyCompletionOutcome.Voided;
      await this.sessionsRepo.save(s);
      await this.eventsRepo.save(
        this.eventsRepo.create({
          sessionId: s.id,
          userId: null,
          type: StudyEventType.Expired,
          payload: null,
        }),
      );
      if (s.status === StudySessionStatus.Expired) {
        await this.notifications.create({
          userId: s.creatorId,
          type: NotificationType.StudySessionMissed,
          title: 'Study invite expired',
          body: 'Your Study Together invite expired — invite again anytime.',
          actionUrl: `/study/invite?friend=${s.inviteeId}`,
          payload: { sessionId: s.id },
          dedupeKey: `study_expired:${s.id}`,
          channels: [NotificationChannel.InApp],
        });
      }
    }

    // Auto-start scheduled waiting sessions past start when both ready
    const waiting = await this.sessionsRepo.find({
      where: {
        status: StudySessionStatus.Waiting,
        scheduledStartAt: LessThan(now),
      },
      take: 20,
    });
    for (const s of waiting) {
      const parts = await this.participantsRepo.find({
        where: { sessionId: s.id },
      });
      if (parts.every((p) => !!p.readyAt) && !s.actualStartAt) {
        s.status = StudySessionStatus.Active;
        s.actualStartAt = now;
        s.plannedEndAt = new Date(
          now.getTime() + s.durationMinutes * 60_000,
        );
        await this.sessionsRepo.save(s);
      }
    }

    // Finalize active sessions past planned end
    const overdue = await this.sessionsRepo.find({
      where: {
        status: StudySessionStatus.Active,
        plannedEndAt: LessThan(now),
      },
      take: 20,
    });
    for (const s of overdue) {
      try {
        await this.finalizeIfDue(s.creatorId, s.id, true);
      } catch (err) {
        this.logger.warn(
          `Auto-finalize failed ${s.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0 Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  day.setUTCDate(day.getUTCDate() + mondayOffset);
  return day;
}
