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
  isUnitPlayContent,
  normalizeUnitPlayContent,
  type UnitPlayContent,
} from '../lessons/lesson-play.types';
import { LessonContentService } from '../lessons/lesson-content.service';
import { RoadmapCacheService } from '../roadmaps/roadmap-cache.service';
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import { ProfileCacheService } from '../profiles/profile-cache.service';
import {
  Lesson,
  LessonStatus,
} from '../roadmaps/entities/lesson.entity';
import { Roadmap, RoadmapStatus } from '../roadmaps/entities/roadmap.entity';
import { SocialPermissionService } from '../social/social-permission.service';
import { User } from '../users/entities/user.entity';
import {
  CreateStudyEpisodeDto,
  CreateStudyPathDto,
  CreateStudySessionDto,
  StudyCompleteDto,
  StudyHeartbeatDto,
  StudyTaskDto,
} from './dto/study-together.dto';
import { randomUUID } from 'crypto';
import { UploadsService } from '../uploads/uploads.service';
import { Unit } from '../content-pool/entities/unit.entity';
import { domainTitle } from '../content-pool/units-catalog.service';
import { StudyPath } from './entities/study-path.entity';
import { StudySessionEvent } from './entities/study-session-event.entity';
import {
  StudySessionMessage,
  type StudyMessageKind,
} from './entities/study-session-message.entity';
import { StudySessionParticipant } from './entities/study-session-participant.entity';
import { StudySession } from './entities/study-session.entity';
import {
  STUDY_ALLOWED_DURATIONS_MIN,
  STUDY_CHAT_AUDIO_MAX_BYTES,
  STUDY_CHAT_AUDIO_MIMES,
  STUDY_CHAT_IMAGE_MAX_BYTES,
  STUDY_CHAT_IMAGE_MIMES,
  STUDY_CHAT_MESSAGE_MAX_LEN,
  STUDY_CHAT_VOICE_MAX_MS,
  STUDY_DISCONNECT_GRACE_SEC,
  STUDY_HEARTBEAT_INTERVAL_SEC,
  STUDY_INVITE_EXPIRY_NOW_MS,
  STUDY_INVITE_EXPIRY_SCHEDULED_AFTER_START_MS,
  STUDY_INVITE_EXPIRY_WITHIN_MS,
  STUDY_MAX_ACTIVE_PATHS,
  STUDY_MAX_CONCURRENT_ROOMS,
  STUDY_MIN_VERIFIED_MINUTES,
  STUDY_PAIR_DAILY_REWARD_CAP,
  STUDY_PATH_INVITE_EXPIRY_MS,
  STUDY_QUALIFY_ACTIVE_RATIO,
  STUDY_SHARED_BONUS_COINS,
  STUDY_SHARED_BONUS_GEMS,
  STUDY_WEEKLY_REWARD_CAP,
  StudyCompletionOutcome,
  StudyEventType,
  StudyInvitationStatus,
  StudyParticipantRole,
  StudyPathStatus,
  StudySessionMode,
  StudySessionStatus,
  StudyStartMode,
  StudySubject,
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

const PATH_LIVE_STATUSES = [
  StudyPathStatus.Invited,
  StudyPathStatus.Active,
];

const PATH_TERMINAL_STATUSES = [
  StudyPathStatus.Completed,
  StudyPathStatus.Declined,
  StudyPathStatus.Cancelled,
  StudyPathStatus.Abandoned,
];

@Injectable()
export class StudyTogetherService {
  private readonly logger = new Logger(StudyTogetherService.name);
  private readonly heartbeatPersistAt = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly socialPermissions: SocialPermissionService,
    private readonly notifications: NotificationsService,
    private readonly ledger: RewardLedgerService,
    private readonly lessonContent: LessonContentService,
    private readonly uploads: UploadsService,
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
    @InjectRepository(StudyPath)
    private readonly pathsRepo: Repository<StudyPath>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    private readonly profileCache: ProfileCacheService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    private readonly roadmapCache: RoadmapCacheService,
  ) {}

  // ─── Unit co-roadmaps (paths) ─────────────────────────────────────────

  /**
   * Stacks pickable for a co-roadmap invite (e.g. digital-marketing, html-css).
   * Prefer stacks from unlocked reading on path; else pool stacks for learner track.
   */
  async listPickableUnits(userId: string) {
    const fromPath = await this.collectPathReadingStacks(userId);
    if (fromPath.length > 0) {
      return { items: fromPath };
    }
    return { items: await this.collectPoolReadingStacks(userId) };
  }

  async createPath(userId: string, dto: CreateStudyPathDto) {
    if (!dto.stack && !dto.unitId && !dto.lessonId) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'stack, unitId, or lessonId required',
      );
    }
    if (dto.partnerId === userId) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Cannot invite yourself',
      );
    }

    const partner = await this.usersRepo.findOne({
      where: { id: dto.partnerId },
    });
    if (!partner) {
      throw new AppException(
        AuthErrorCode.SOCIAL_USER_NOT_FOUND,
        'Partner not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const gate = await this.socialPermissions.canStudyInvite(
      userId,
      dto.partnerId,
    );
    if (!gate.allowed) {
      throw new AppException(
        AuthErrorCode.STUDY_INVITE_NOT_ALLOWED,
        'Study invite not allowed',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.assertPathCap(userId);
    await this.assertPathCap(dto.partnerId);

    const stack = await this.resolveStackSlug(userId, dto);
    const readingUnits = await this.listReadingUnitsForStack(stack);
    if (readingUnits.length === 0) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'No reading units in this stack',
        HttpStatus.NOT_FOUND,
      );
    }

    const existing = await this.findOpenPathForPairStack(
      userId,
      dto.partnerId,
      stack,
    );
    if (existing) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_CONFLICT,
        'You already have an open co-roadmap on this stack with this friend',
      );
    }

    const firstUnit = readingUnits[0]!;
    const lessonMeta = await this.ensureStudyReadingLesson(
      userId,
      firstUnit.id,
    );
    const category = (firstUnit.domain || stack || 'general').slice(0, 64);
    const title = domainTitle(stack);
    const message = dto.message?.trim() ? dto.message.trim() : null;
    const now = new Date();
    const inviteExpiresAt = new Date(
      now.getTime() + STUDY_PATH_INVITE_EXPIRY_MS,
    );

    const path = await this.pathsRepo.save(
      this.pathsRepo.create({
        creatorId: userId,
        partnerId: dto.partnerId,
        stack,
        creatorLessonId: lessonMeta.id,
        category,
        title,
        status: StudyPathStatus.Invited,
        contentStep: 0,
        stepCount: readingUnits.length,
        progressPercent: 0,
        inviteMessage: message,
        inviteExpiresAt,
      }),
    );

    const creatorName = await this.displayName(userId);
    await this.notifications.create({
      userId: dto.partnerId,
      type: NotificationType.StudyInvite,
      title: 'Study Together path invite',
      body: `${creatorName} invited you to learn "${title}" together.`,
      actionUrl: `/study/path?id=${path.id}`,
      payload: { pathId: path.id },
      dedupeKey: `study_path_invite:${path.id}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });

    return this.getPathState(userId, path.id);
  }

  async listPaths(userId: string) {
    const paths = await this.pathsRepo.find({
      where: [
        { creatorId: userId, status: In(PATH_LIVE_STATUSES) },
        { partnerId: userId, status: In(PATH_LIVE_STATUSES) },
        { creatorId: userId, status: StudyPathStatus.Completed },
        { partnerId: userId, status: StudyPathStatus.Completed },
      ],
      order: { updatedAt: 'DESC' },
      take: 50,
    });

    const items = await Promise.all(
      paths.map((p) => this.toPathDto(userId, p)),
    );
    return { items };
  }

  async getPathState(userId: string, pathId: string) {
    const path = await this.requirePathParticipant(userId, pathId);
    return this.toPathDto(userId, path);
  }

  async acceptPath(userId: string, pathId: string) {
    const path = await this.requirePathParticipant(userId, pathId);
    if (path.partnerId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Only partner can accept',
        HttpStatus.FORBIDDEN,
      );
    }
    if (path.status !== StudyPathStatus.Invited) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Path invite is not open',
      );
    }
    this.assertPathInviteFresh(path);
    path.status = StudyPathStatus.Active;
    path.progressPercent = this.computePathProgress(path);
    await this.pathsRepo.save(path);
    return this.getPathState(userId, pathId);
  }

  async declinePath(userId: string, pathId: string) {
    const path = await this.requirePathParticipant(userId, pathId);
    if (path.partnerId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Only partner can decline',
        HttpStatus.FORBIDDEN,
      );
    }
    if (path.status !== StudyPathStatus.Invited) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Path invite is not open',
      );
    }
    path.status = StudyPathStatus.Declined;
    await this.pathsRepo.save(path);
    return this.getPathState(userId, pathId);
  }

  async cancelPath(userId: string, pathId: string) {
    const path = await this.requirePathParticipant(userId, pathId);
    if (path.creatorId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Only creator can cancel',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      ![StudyPathStatus.Invited, StudyPathStatus.Active].includes(path.status)
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Path cannot be cancelled now',
      );
    }
    path.status = StudyPathStatus.Cancelled;
    await this.pathsRepo.save(path);
    return this.getPathState(userId, pathId);
  }

  async createEpisode(userId: string, pathId: string, dto: CreateStudyEpisodeDto) {
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

    const path = await this.requirePathParticipant(userId, pathId);
    if (path.status !== StudyPathStatus.Active) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Path must be active to start a session',
      );
    }
    if (path.contentStep >= path.stepCount && path.stepCount > 0) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Path already completed',
      );
    }

    await this.assertRoomCap(path.creatorId);
    await this.assertRoomCap(path.partnerId);

    const liveOnPath = await this.sessionsRepo.count({
      where: {
        pathId: path.id,
        status: In(LIVE_STATUSES),
      },
    });
    if (liveOnPath > 0) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_CONFLICT,
        'This path already has a live session',
      );
    }

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
      inviteExpiresAt = new Date(now.getTime() + STUDY_INVITE_EXPIRY_WITHIN_MS);
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

    const inviteeId =
      path.creatorId === userId ? path.partnerId : path.creatorId;

    const readingUnits = await this.listReadingUnitsForStack(path.stack);
    const currentUnit =
      readingUnits[Math.min(path.contentStep, Math.max(readingUnits.length - 1, 0))];
    if (!currentUnit) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'No reading unit left on this stack',
      );
    }
    const currentLesson = await this.ensureStudyReadingLesson(
      path.creatorId,
      currentUnit.id,
    );
    const playContent = await this.lessonContent.ensurePlayContent(currentLesson);
    const episodeStepCount = this.computeStepCount(playContent);

    if (path.creatorLessonId !== currentLesson.id) {
      path.creatorLessonId = currentLesson.id;
      await this.pathsRepo.save(path);
    }

    const session = await this.dataSource.transaction(async (manager) => {
      const row = manager.create(StudySession, {
        pathId: path.id,
        creatorId: userId,
        inviteeId,
        subject: StudySubject.CurrentTrack,
        lessonId: currentLesson.id,
        unitId: currentUnit.id,
        lessonTitle: currentUnit.title,
        mode: StudySessionMode.ReadTogether,
        contentStep: 0,
        stepCount: episodeStepCount,
        durationMinutes: dto.durationMinutes,
        startMode: dto.startMode,
        message: null,
        status:
          dto.startMode === StudyStartMode.Now
            ? StudySessionStatus.Waiting
            : StudySessionStatus.Accepted,
        scheduledStartAt,
        scheduledEndAt,
        inviteExpiresAt,
        completionOutcome: StudyCompletionOutcome.None,
      });
      const saved = await manager.save(row);

      const priorStep = Math.max(path.contentStep - 1, -1);
      await manager.save([
        manager.create(StudySessionParticipant, {
          sessionId: saved.id,
          userId,
          role: StudyParticipantRole.Creator,
          invitationStatus: StudyInvitationStatus.Accepted,
          joinedAt: now,
          readyAt: now,
          taskLabel: path.title,
          ackedStep: priorStep,
        }),
        manager.create(StudySessionParticipant, {
          sessionId: saved.id,
          userId: inviteeId,
          role: StudyParticipantRole.Invitee,
          invitationStatus: StudyInvitationStatus.Accepted,
          joinedAt: now,
          taskLabel: path.title,
          ackedStep: priorStep,
        }),
      ]);

      await this.appendEvent(manager, {
        sessionId: saved.id,
        userId,
        type: StudyEventType.InviteSent,
        payload: {
          pathId: path.id,
          episode: true,
          durationMinutes: dto.durationMinutes,
          startMode: dto.startMode,
          contentStep: path.contentStep,
        },
      });

      return saved;
    });

    const starterName = await this.displayName(userId);
    await this.notifications.create({
      userId: inviteeId,
      type: NotificationType.StudyInvite,
      title: 'Study session started',
      body: `${starterName} started a study session on "${path.title}".`,
      actionUrl: `/study/room?id=${session.id}`,
      payload: { sessionId: session.id, pathId: path.id },
      dedupeKey: `study_episode:${session.id}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });

    return this.getState(userId, session.id);
  }

  async create(userId: string, dto: CreateStudySessionDto) {
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
    const sessions = await this.sessionsRepo.find({
      where: [
        { creatorId: userId, status: In(LIVE_STATUSES) },
        { inviteeId: userId, status: In(LIVE_STATUSES) },
      ],
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return {
      items: await this.buildStatesForSessions(userId, sessions),
    };
  }

  async listInvites(userId: string) {
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
      items: await this.buildStatesForSessions(userId, sessions),
    };
  }

  async accept(userId: string, sessionId: string) {
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

    await this.wipeSessionChat(sessionId);
    return this.getState(userId, sessionId);
  }

  async cancel(userId: string, sessionId: string) {
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

    await this.wipeSessionChat(sessionId);
    return this.getState(userId, sessionId);
  }

  async setTask(userId: string, sessionId: string, dto: StudyTaskDto) {
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
    const session = await this.requireParticipantSession(userId, sessionId);
    if (session.status !== StudySessionStatus.Active) {
      return this.getState(userId, sessionId);
    }

    const now = new Date();
    const appVisible = dto.appVisible !== false;
    const focusActive = dto.focusActive !== false;
    const persistKey = `${sessionId}:${userId}`;
    const lastPersist = this.heartbeatPersistAt.get(persistKey) ?? 0;
    const shouldPersist = now.getTime() - lastPersist >= 5_000;

    if (shouldPersist) {
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
      this.heartbeatPersistAt.set(persistKey, now.getTime());
    }

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

    if (session.status === StudySessionStatus.Abandoned) {
      await this.wipeSessionChat(sessionId);
    }

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
        if (session.pathId) {
          await this.advancePathStackUnit(manager, session.pathId);
        }
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

    const partnerReadAt = await this.getPartnerChatReadAt(sessionId, userId);

    const items = page.reverse().map((m) => {
      const profile = profileMap.get(m.senderId);
      const name =
        profile?.displayName || profile?.username || 'Learner';
      return this.toMessageDto(m, name, {
        viewerId: userId,
        partnerReadAt,
      });
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

    await this.assertChatRateLimit(sessionId, userId);

    const saved = await this.dataSource.transaction(async (manager) => {
      const row = manager.create(StudySessionMessage, {
        sessionId,
        senderId: userId,
        kind: 'text',
        body,
        mediaKey: null,
        mediaMime: null,
        durationMs: null,
      });
      const msg = await manager.save(row);
      await this.appendEvent(manager, {
        sessionId,
        userId,
        type: StudyEventType.ChatMessage,
        payload: { messageId: msg.id, kind: 'text' },
      });
      session.roomVersion += 1;
      await manager.save(session);
      return msg;
    });

    const profile = await this.profilesRepo.findOne({ where: { userId } });
    const senderName =
      profile?.displayName || profile?.username || 'Learner';

    return this.toMessageDto(saved, senderName, {
      viewerId: userId,
      partnerReadAt: null,
    });
  }

  async sendChatMedia(
    userId: string,
    sessionId: string,
    file: Express.Multer.File,
    opts: {
      kind: 'voice' | 'image';
      durationMs?: number;
      caption?: string;
    },
  ) {
    const session = await this.requireParticipantSession(userId, sessionId);
    if (TERMINAL_STATUSES.includes(session.status)) {
      throw new AppException(
        AuthErrorCode.STUDY_INVALID_STATE,
        'Session already ended',
      );
    }

    const kind = opts.kind;
    const mime = (file.mimetype || '').toLowerCase();
    if (kind === 'image') {
      if (!STUDY_CHAT_IMAGE_MIMES.has(mime)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Image must be jpeg, png, or webp',
        );
      }
      if (file.size > STUDY_CHAT_IMAGE_MAX_BYTES) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Image too large (max 2MB)',
        );
      }
    } else {
      if (!STUDY_CHAT_AUDIO_MIMES.has(mime)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Unsupported audio format',
        );
      }
      if (file.size > STUDY_CHAT_AUDIO_MAX_BYTES) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Voice message too large (max 2MB)',
        );
      }
      const durationMs = opts.durationMs ?? 0;
      if (durationMs <= 0 || durationMs > STUDY_CHAT_VOICE_MAX_MS) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Voice must be 1–60 seconds',
        );
      }
    }

    const caption = (opts.caption ?? '').trim();
    if (caption.length > STUDY_CHAT_MESSAGE_MAX_LEN) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Caption too long',
      );
    }

    await this.assertChatRateLimit(sessionId, userId);

    const ext = this.extForMime(mime);
    const mediaKey = `/uploads/study-chat/${sessionId}/${randomUUID()}.${ext}`;
    await this.uploads.put(mediaKey, mime, file.buffer);

    let saved: StudySessionMessage;
    try {
      saved = await this.dataSource.transaction(async (manager) => {
        const row = manager.create(StudySessionMessage, {
          sessionId,
          senderId: userId,
          kind,
          body: caption,
          mediaKey,
          mediaMime: mime,
          durationMs: kind === 'voice' ? (opts.durationMs ?? null) : null,
        });
        const msg = await manager.save(row);
        await this.appendEvent(manager, {
          sessionId,
          userId,
          type: StudyEventType.ChatMessage,
          payload: { messageId: msg.id, kind },
        });
        session.roomVersion += 1;
        await manager.save(session);
        return msg;
      });
    } catch (err) {
      await this.uploads.remove(mediaKey).catch(() => undefined);
      throw err;
    }

    const profile = await this.profilesRepo.findOne({ where: { userId } });
    const senderName =
      profile?.displayName || profile?.username || 'Learner';

    return this.toMessageDto(saved, senderName, {
      viewerId: userId,
      partnerReadAt: null,
    });
  }

  async getChatMedia(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<{ mime: string; data: Buffer }> {
    await this.requireParticipantSession(userId, sessionId);
    const msg = await this.messagesRepo.findOne({
      where: { id: messageId, sessionId },
    });
    if (!msg?.mediaKey) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Media not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const asset = await this.uploads.get(msg.mediaKey);
    if (!asset?.data) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Media not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return { mime: asset.mime || msg.mediaMime || 'application/octet-stream', data: asset.data };
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
    const [state] = await this.buildStatesForSessions(userId, [session]);
    return state;
  }

  private async buildStatesForSessions(
    userId: string,
    sessions: StudySession[],
  ) {
    if (!sessions.length) return [];
    const sessionIds = sessions.map((s) => s.id);
    const participants = await this.participantsRepo.find({
      where: { sessionId: In(sessionIds) },
    });
    const participantsBySession = new Map<string, StudySessionParticipant[]>();
    for (const participant of participants) {
      const bucket = participantsBySession.get(participant.sessionId) ?? [];
      bucket.push(participant);
      participantsBySession.set(participant.sessionId, bucket);
    }

    const userIds = new Set<string>();
    for (const session of sessions) {
      userIds.add(session.creatorId);
      userIds.add(session.inviteeId);
    }
    const profileMap = await this.loadProfilesForUsers([...userIds]);

    return sessions.map((session) =>
      this.buildStateDto(
        userId,
        session,
        participantsBySession.get(session.id) ?? [],
        profileMap,
      ),
    );
  }

  private async loadProfilesForUsers(
    userIds: string[],
  ): Promise<Map<string, Profile>> {
    const map = new Map<string, Profile>();
    const missing: string[] = [];

    for (const id of userIds) {
      const cached = await this.profileCache.get(id);
      if (cached) {
        map.set(
          id,
          Object.assign(new Profile(), {
            userId: cached.userId,
            displayName: cached.displayName,
            username: cached.username,
          }),
        );
      } else {
        missing.push(id);
      }
    }

    if (missing.length) {
      const profiles = await this.profilesRepo.find({
        where: { userId: In(missing) },
      });
      await this.profileCache.setMany(profiles);
      for (const profile of profiles) {
        map.set(profile.userId, profile);
      }
    }

    return map;
  }

  private buildStateDto(
    userId: string,
    session: StudySession,
    participants: StudySessionParticipant[],
    profileMap: Map<string, Profile>,
  ) {
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
      pathId: session.pathId ?? null,
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
      await this.wipeSessionChat(sessionId);
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
    await this.wipeSessionChat(sessionId);

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

  private toMessageDto(
    m: StudySessionMessage,
    senderName: string,
    opts?: { viewerId?: string; partnerReadAt?: Date | null },
  ) {
    const kind: StudyMessageKind = m.kind || 'text';
    const createdAt = m.createdAt.toISOString();
    const viewerId = opts?.viewerId;
    const partnerReadAt = opts?.partnerReadAt ?? null;
    const seen =
      !!viewerId &&
      m.senderId === viewerId &&
      !!partnerReadAt &&
      m.createdAt.getTime() <= partnerReadAt.getTime();
    return {
      id: m.id,
      sessionId: m.sessionId,
      senderId: m.senderId,
      senderName,
      kind,
      body: m.body ?? '',
      mediaUrl:
        kind !== 'text' && m.mediaKey
          ? `/study-together/${m.sessionId}/media/${m.id}`
          : null,
      mediaMime: m.mediaMime,
      durationMs: m.durationMs,
      seen,
      createdAt,
    };
  }

  private async getPartnerChatReadAt(
    sessionId: string,
    userId: string,
  ): Promise<Date | null> {
    const all = await this.participantsRepo.find({ where: { sessionId } });
    const other = all.find((p) => p.userId !== userId);
    return other?.chatLastReadAt ?? null;
  }

  /**
   * Advance chat read watermark for viewer; broadcast to partner for receipts.
   */
  async markChatRead(
    userId: string,
    sessionId: string,
    messageId?: string,
  ): Promise<{ userId: string; readAt: string; messageId: string | null }> {
    await this.requireParticipantSession(userId, sessionId);

    let readAt = new Date();
    let resolvedMessageId: string | null = messageId ?? null;

    if (messageId) {
      const msg = await this.messagesRepo.findOne({
        where: { id: messageId, sessionId },
      });
      if (!msg) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Message not found',
          HttpStatus.NOT_FOUND,
        );
      }
      readAt = msg.createdAt;
      resolvedMessageId = msg.id;
    } else {
      const latest = await this.messagesRepo.find({
        where: { sessionId },
        order: { createdAt: 'DESC' },
        take: 1,
      });
      if (latest[0]) {
        readAt = latest[0].createdAt;
        resolvedMessageId = latest[0].id;
      }
    }

    const me = await this.participantsRepo.findOneOrFail({
      where: { sessionId, userId },
    });
    if (
      me.chatLastReadAt &&
      me.chatLastReadAt.getTime() >= readAt.getTime()
    ) {
      return {
        userId,
        readAt: me.chatLastReadAt.toISOString(),
        messageId: resolvedMessageId,
      };
    }

    me.chatLastReadAt = readAt;
    await this.participantsRepo.save(me);

    return {
      userId,
      readAt: readAt.toISOString(),
      messageId: resolvedMessageId,
    };
  }

  private async assertChatRateLimit(sessionId: string, userId: string) {
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
  }

  private extForMime(mime: string): string {
    switch (mime) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      case 'audio/webm':
        return 'webm';
      case 'audio/mp4':
        return 'm4a';
      case 'audio/mpeg':
        return 'mp3';
      case 'audio/ogg':
        return 'ogg';
      case 'audio/wav':
        return 'wav';
      default:
        return 'bin';
    }
  }

  /** Delete all chat messages + media blobs for a session (ephemeral room chat). */
  private async wipeSessionChat(sessionId: string) {
    try {
      const rows = await this.messagesRepo.find({
        where: { sessionId },
        select: { id: true, mediaKey: true },
      });
      for (const row of rows) {
        if (!row.mediaKey) continue;
        try {
          await this.uploads.remove(row.mediaKey);
        } catch (err) {
          this.logger.warn(
            `Failed to remove study chat media ${row.mediaKey}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      await this.messagesRepo.delete({ sessionId });
    } catch (err) {
      this.logger.warn(
        `wipeSessionChat failed for ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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

  private async assertPathCap(userId: string) {
    const count = await this.pathsRepo.count({
      where: [
        { creatorId: userId, status: In(PATH_LIVE_STATUSES) },
        { partnerId: userId, status: In(PATH_LIVE_STATUSES) },
      ],
    });
    if (count >= STUDY_MAX_ACTIVE_PATHS) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_CONFLICT,
        'Too many open Study Together paths',
      );
    }
  }

  private async findOpenPathForPairStack(
    userA: string,
    userB: string,
    stack: string,
  ) {
    return this.pathsRepo.findOne({
      where: [
        {
          creatorId: userA,
          partnerId: userB,
          stack,
          status: In(PATH_LIVE_STATUSES),
        },
        {
          creatorId: userB,
          partnerId: userA,
          stack,
          status: In(PATH_LIVE_STATUSES),
        },
      ],
    });
  }

  private async requirePathParticipant(userId: string, pathId: string) {
    const path = await this.pathsRepo.findOne({ where: { id: pathId } });
    if (!path) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_FOUND,
        'Path not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (path.creatorId !== userId && path.partnerId !== userId) {
      throw new AppException(
        AuthErrorCode.STUDY_SESSION_NOT_PARTICIPANT,
        'Not a path participant',
        HttpStatus.FORBIDDEN,
      );
    }
    return path;
  }

  private assertPathInviteFresh(path: StudyPath) {
    if (
      path.inviteExpiresAt &&
      path.inviteExpiresAt.getTime() < Date.now()
    ) {
      throw new AppException(
        AuthErrorCode.STUDY_INVITE_EXPIRED,
        'Path invite expired',
      );
    }
  }

  private computePathProgress(path: {
    contentStep: number;
    stepCount: number;
    status: StudyPathStatus;
  }): number {
    if (path.status === StudyPathStatus.Completed) return 100;
    const total = Math.max(path.stepCount, 1);
    return Math.min(
      100,
      Math.round(((path.contentStep + 1) / total) * 100),
    );
  }

  /** Finish current stack reading-unit; advance path index or complete. */
  private async advancePathStackUnit(
    manager: EntityManager,
    pathId: string,
  ) {
    const path = await manager.findOne(StudyPath, { where: { id: pathId } });
    if (!path || PATH_TERMINAL_STATUSES.includes(path.status)) return;

    if (path.status === StudyPathStatus.Invited) {
      path.status = StudyPathStatus.Active;
    }

    const isLastUnit = path.contentStep >= path.stepCount - 1;
    if (isLastUnit) {
      path.status = StudyPathStatus.Completed;
      path.progressPercent = 100;
      await manager.save(path);
      return;
    }

    path.contentStep += 1;
    const units = await this.listReadingUnitsForStack(path.stack);
    const next = units[path.contentStep];
    if (next) {
      const lesson = await this.ensureStudyReadingLesson(
        path.creatorId,
        next.id,
      );
      path.creatorLessonId = lesson.id;
    }
    path.progressPercent = this.computePathProgress(path);
    await manager.save(path);
  }

  private async toPathDto(viewerId: string, path: StudyPath) {
    const partnerId =
      path.creatorId === viewerId ? path.partnerId : path.creatorId;
    const profiles = await this.profilesRepo.find({
      where: { userId: In([path.creatorId, path.partnerId]) },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const partnerProfile = profileMap.get(partnerId);
    const partnerName =
      partnerProfile?.displayName ||
      partnerProfile?.username ||
      'Learner';
    const partnerInitial = partnerName.charAt(0).toUpperCase();

    const liveSession = await this.sessionsRepo.findOne({
      where: {
        pathId: path.id,
        status: In(LIVE_STATUSES),
      },
      order: { updatedAt: 'DESC' },
    });

    const recentEpisodes = await this.sessionsRepo.find({
      where: { pathId: path.id },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const role: 'creator' | 'partner' =
      path.creatorId === viewerId ? 'creator' : 'partner';

    return {
      id: path.id,
      status: path.status,
      stack: path.stack,
      unitId: path.stack,
      creatorLessonId: path.creatorLessonId,
      category: path.category,
      title: path.title,
      contentStep: path.contentStep,
      stepCount: path.stepCount,
      progressPercent: path.progressPercent,
      inviteMessage: path.inviteMessage,
      inviteExpiresAt: path.inviteExpiresAt?.toISOString() ?? null,
      role,
      partner: {
        userId: partnerId,
        name: partnerName,
        initial: partnerInitial,
        avatarUrl: partnerProfile?.avatarUrl ?? null,
      },
      activeSessionId: liveSession?.id ?? null,
      episodes: recentEpisodes.map((s) => ({
        id: s.id,
        status: s.status,
        contentStep: s.contentStep,
        stepCount: s.stepCount,
        durationMinutes: s.durationMinutes,
        createdAt: s.createdAt.toISOString(),
      })),
      createdAt: path.createdAt.toISOString(),
      updatedAt: path.updatedAt.toISOString(),
    };
  }

  private async resolveStackSlug(
    userId: string,
    dto: CreateStudyPathDto,
  ): Promise<string> {
    const direct = (dto.stack || dto.unitId)?.trim();
    if (direct) {
      // Accept stack slug, or a content-unit id → resolve its stack.
      const asStack = await this.listReadingUnitsForStack(direct);
      if (asStack.length > 0) return direct;

      const unit = await this.unitsRepo.findOne({ where: { id: direct } });
      if (unit?.stack?.trim()) return unit.stack.trim();

      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Unknown stack',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.lessonId) {
      const meta = await this.resolveCreatorLesson(userId, dto.lessonId);
      if (!meta.unitId) {
        throw new AppException(
          AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
          'Lesson has no unit binding',
        );
      }
      const unit = await this.unitsRepo.findOne({ where: { id: meta.unitId } });
      if (!unit?.stack?.trim()) {
        throw new AppException(
          AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
          'Lesson unit has no stack',
        );
      }
      return unit.stack.trim();
    }

    throw new AppException(
      AuthErrorCode.VALIDATION_ERROR,
      'stack required',
    );
  }

  private async listReadingUnitsForStack(stack: string): Promise<Unit[]> {
    const units = await this.unitsRepo.find({
      where: {
        stack,
        lessonType: 'reading',
        isActive: true,
      },
      order: { level: 'ASC', title: 'ASC' },
    });
    return units.filter(
      (u) => isUnitPlayContent(u.content) && isReadingContent(u.content),
    );
  }

  private async summarizeStack(
    stack: string,
    source: 'path' | 'pool',
  ): Promise<{
    stack: string;
    unitId: string;
    lessonId: string | null;
    title: string;
    estimatedMinutes: number;
    readingCount: number;
    status: LessonStatus;
    source: 'path' | 'pool';
    category: string;
  } | null> {
    const units = await this.listReadingUnitsForStack(stack);
    if (units.length === 0) return null;
    const estimatedMinutes = units.reduce(
      (sum, u) => sum + (u.estimatedMinutes || 0),
      0,
    );
    return {
      stack,
      unitId: stack,
      lessonId: null,
      title: domainTitle(stack),
      estimatedMinutes,
      readingCount: units.length,
      status: LessonStatus.Available,
      source,
      category: units[0]?.domain || stack,
    };
  }

  private async collectPathReadingStacks(userId: string) {
    const lessons = await this.lessonsRepo
      .createQueryBuilder('l')
      .innerJoin('l.milestone', 'm')
      .innerJoin('m.phase', 'p')
      .innerJoin('p.roadmap', 'r')
      .where('r.userId = :userId', { userId })
      .andWhere('r.status = :status', { status: RoadmapStatus.Ready })
      .andWhere('l.lessonType = :type', { type: 'reading' })
      .andWhere('l.status IN (:...statuses)', {
        statuses: [LessonStatus.Available, LessonStatus.Completed],
      })
      .andWhere('l.unitId IS NOT NULL')
      .getMany();

    const unitIds = [
      ...new Set(
        lessons
          .map((l) => l.unitId?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (unitIds.length === 0) return [];

    const linked = await this.unitsRepo.find({ where: { id: In(unitIds) } });
    const stacks = [
      ...new Set(
        linked
          .map((u) => u.stack?.trim())
          .filter((s): s is string => Boolean(s)),
      ),
    ];

    const items: NonNullable<
      Awaited<ReturnType<StudyTogetherService['summarizeStack']>>
    >[] = [];
    for (const stack of stacks.sort()) {
      const summary = await this.summarizeStack(stack, 'path');
      if (summary) items.push(summary);
    }
    return items;
  }

  private async collectPoolReadingStacks(userId: string) {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { userId, status: RoadmapStatus.Ready },
      relations: { phases: true },
      order: { updatedAt: 'DESC' },
    });
    if (!roadmap) return [];

    const domains = new Set<string>();
    const stackHints = new Set<string>();
    if (roadmap.primaryRoleSlug?.trim()) {
      domains.add(roadmap.primaryRoleSlug.trim());
      stackHints.add(roadmap.primaryRoleSlug.trim());
    }
    for (const phase of roadmap.phases ?? []) {
      if (phase.techStackSlug?.trim()) {
        stackHints.add(phase.techStackSlug.trim());
      }
    }

    const linkedUnitIds = (
      await this.lessonsRepo
        .createQueryBuilder('l')
        .innerJoin('l.milestone', 'm')
        .innerJoin('m.phase', 'p')
        .innerJoin('p.roadmap', 'r')
        .where('r.userId = :userId', { userId })
        .andWhere('r.id = :roadmapId', { roadmapId: roadmap.id })
        .andWhere('l.unitId IS NOT NULL')
        .select('DISTINCT l.unitId', 'unitId')
        .getRawMany<{ unitId: string }>()
    )
      .map((r) => r.unitId?.trim())
      .filter((id): id is string => Boolean(id));

    if (linkedUnitIds.length > 0) {
      const linked = await this.unitsRepo.find({
        where: { id: In(linkedUnitIds) },
      });
      for (const u of linked) {
        if (u.domain?.trim()) domains.add(u.domain.trim());
        if (u.stack?.trim()) stackHints.add(u.stack.trim());
      }
    }

    if (domains.size === 0 && stackHints.size === 0) {
      return [];
    }

    const qb = this.unitsRepo
      .createQueryBuilder('unit')
      .select('DISTINCT unit.stack', 'stack')
      .where('unit.lessonType = :type', { type: 'reading' })
      .andWhere('unit.isActive = true');

    if (domains.size > 0 && stackHints.size > 0) {
      qb.andWhere(
        '(unit.domain IN (:...domains) OR unit.stack IN (:...stacks))',
        { domains: [...domains], stacks: [...stackHints] },
      );
    } else if (domains.size > 0) {
      qb.andWhere('unit.domain IN (:...domains)', { domains: [...domains] });
    } else {
      qb.andWhere('unit.stack IN (:...stacks)', { stacks: [...stackHints] });
    }

    const rows = await qb.getRawMany<{ stack: string }>();
    const items: NonNullable<
      Awaited<ReturnType<StudyTogetherService['summarizeStack']>>
    >[] = [];
    for (const row of rows) {
      const stack = row.stack?.trim();
      if (!stack) continue;
      const summary = await this.summarizeStack(stack, 'pool');
      if (summary) items.push(summary);
    }
    return items.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Materialize an optional reading lesson for Study Together when the unit
   * exists in the content pool but was never unlocked on the personal path.
   */
  private async ensureStudyReadingLesson(userId: string, unitId: string) {
    const unit = await this.unitsRepo.findOne({ where: { id: unitId } });
    if (!unit || unit.lessonType !== 'reading') {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Unit not available as reading',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!isUnitPlayContent(unit.content) || !isReadingContent(unit.content)) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'Unit content is not reading',
      );
    }

    // Prefer a personal lesson already unlocked/completed — never force-unlock
    // locked career-path lessons for Study Together (that bleeds into /path).
    const personal = await this.lessonsRepo
      .createQueryBuilder('l')
      .innerJoin('l.milestone', 'm')
      .innerJoin('m.phase', 'p')
      .innerJoin('p.roadmap', 'r')
      .where('r.userId = :userId', { userId })
      .andWhere('r.status = :status', { status: RoadmapStatus.Ready })
      .andWhere('l.unitId = :unitId', { unitId })
      .andWhere('l.lessonType = :type', { type: 'reading' })
      .andWhere('(l.entryAction IS NULL OR l.entryAction <> :st)', {
        st: 'study_together',
      })
      .getOne();
    if (
      personal &&
      (personal.status === LessonStatus.Available ||
        personal.status === LessonStatus.Completed)
    ) {
      return personal;
    }

    // Reuse an existing Study Together satellite for this unit.
    const satellite = await this.lessonsRepo
      .createQueryBuilder('l')
      .innerJoin('l.milestone', 'm')
      .innerJoin('m.phase', 'p')
      .innerJoin('p.roadmap', 'r')
      .where('r.userId = :userId', { userId })
      .andWhere('r.status = :status', { status: RoadmapStatus.Ready })
      .andWhere('l.unitId = :unitId', { unitId })
      .andWhere('l.lessonType = :type', { type: 'reading' })
      .andWhere('l.entryAction = :st', { st: 'study_together' })
      .getOne();
    if (satellite) {
      return satellite;
    }

    const anchor = await this.lessonsRepo
      .createQueryBuilder('l')
      .innerJoin('l.milestone', 'm')
      .innerJoin('m.phase', 'p')
      .innerJoin('p.roadmap', 'r')
      .where('r.userId = :userId', { userId })
      .andWhere('r.status = :status', { status: RoadmapStatus.Ready })
      .orderBy('p.orderIndex', 'ASC')
      .addOrderBy('m.orderIndex', 'ASC')
      .addOrderBy('l.orderIndex', 'DESC')
      .getOne();

    if (!anchor) {
      throw new AppException(
        AuthErrorCode.STUDY_TASK_NOT_AVAILABLE,
        'No active roadmap',
      );
    }

    const playContent = normalizeUnitPlayContent(unit.content);
    const lesson = await this.lessonsRepo.save(
      this.lessonsRepo.create({
        milestoneId: anchor.milestoneId,
        unitId: unit.id,
        title: unit.title,
        description: '',
        lessonType: 'reading',
        estimatedMinutes: unit.estimatedMinutes,
        xpReward: unit.xp,
        orderIndex: anchor.orderIndex + 1,
        required: false,
        status: LessonStatus.Available,
        playContent: playContent as unknown as Record<string, unknown>,
        objective: playContent.objective ?? null,
        provider: unit.provider,
        url: unit.url,
        level: unit.level,
        skillsTaught: unit.skillsTaught ?? [],
        unitRole: unit.unitRole,
        servesStage: unit.servesStage ?? [],
        entryAction: 'study_together',
        materializedWindow: null,
      }),
    );

    const ready = await this.roadmapsRepo.findOne({
      where: { userId, status: RoadmapStatus.Ready },
      order: { updatedAt: 'DESC' },
    });
    if (ready) {
      await this.roadmapCache.invalidateRoadmap(ready.id, userId);
    }

    return lesson;
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
      avatarUrl: profile?.avatarUrl ?? null,
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

  async performMaintenance() {
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
      await this.wipeSessionChat(s.id);
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
