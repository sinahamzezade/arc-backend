import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { BadgesService } from '../badges/badges.service';
import { OUTBOX_BATTLE_COMPLETED } from '../badges/badge.constants';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { ContentQualityService } from '../content-pool/content-quality.service';
import { QuestionPoolService } from '../content-pool/question-pool.service';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { RewardLedgerService } from '../gamification/reward-ledger.service';
import { UserLeagueState } from '../leagues/entities/user-league-state.entity';
import { LeagueScoreSourceType } from '../leagues/entities/league.enums';
import { LeaguesService } from '../leagues/leagues.service';
import { NotificationChannel } from '../notifications/entities/notification.entity';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { SocialPermissionService } from '../social/social-permission.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  BATTLE_ASYNC_INVITE_TTL_MS,
  BATTLE_ASYNC_PLAY_TTL_MS,
  BATTLE_COMPLETION_XP,
  BATTLE_CORRECT_XP,
  BATTLE_DISCONNECT_FORFEIT_MS,
  BATTLE_DISCONNECT_GRACE_MS,
  BATTLE_INVITE_EXPIRING_REMAINING_RATIO,
  BATTLE_LEAGUE_XP_DAILY_CAP,
  BATTLE_LIVE_INVITE_TTL_MS,
  BATTLE_PAIR_XP_DAILY_CAP,
  BATTLE_PARTICIPATION_COINS,
  BATTLE_PARTICIPATION_COINS_DAILY_CAP,
  BATTLE_PERFECT_XP,
  BATTLE_SUDDEN_DEATH_MAX,
  BATTLE_WIN_XP,
  BattleEscrowStatus,
  BattleEventType,
  BattleMode,
  BattleParticipantRole,
  BattleResultReason,
  BattleStatus,
  maxStakeForRankLevel,
} from './battle.constants';
import { scoreBattleAnswer } from './battle-scoring';
import { CreateBattleDto, SubmitBattleAnswerDto } from './dto/battles.dto';
import { BattleAnswer } from './entities/battle-answer.entity';
import { BattleCoinEscrow } from './entities/battle-coin-escrow.entity';
import { BattleEvent } from './entities/battle-event.entity';
import { BattleParticipant } from './entities/battle-participant.entity';
import { BattleQuestion } from './entities/battle-question.entity';
import { BattleResult } from './entities/battle-result.entity';
import { Battle } from './entities/battle.entity';
import { toBattleDto, toHistoryItemDto } from './battles.serializer';

const ACTIVE_STATUSES = [
  BattleStatus.Invited,
  BattleStatus.Accepted,
  BattleStatus.Funding,
  BattleStatus.Ready,
  BattleStatus.InProgress,
  BattleStatus.SuddenDeath,
];

/** Auto-timeout answer key — must fit battle_answers.idempotency_key. */
function timeoutAnswerIdemKey(
  questionId: string,
  participantId: string,
): string {
  const q = questionId.replace(/-/g, '');
  const p = participantId.replace(/-/g, '');
  return `t:${q}:${p.slice(0, 24)}`;
}

/**
 * Scope client idempotency keys per user so both players can submit the same
 * question without the second answer being treated as a duplicate.
 */
function answerIdempotencyKey(userId: string, clientKey: string): string {
  const raw = `u:${userId}:${clientKey}`;
  return raw.length <= 128 ? raw : raw.slice(0, 128);
}

@Injectable()
export class BattlesService {
  private readonly logger = new Logger(BattlesService.name);
  private eventSeq = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly questionPool: QuestionPoolService,
    private readonly contentQuality: ContentQualityService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly leagues: LeaguesService,
    private readonly socialPermissions: SocialPermissionService,
    private readonly ledger: RewardLedgerService,
    @Optional()
    @Inject(forwardRef(() => BadgesService))
    private readonly badges: BadgesService | undefined,
    @InjectRepository(Battle)
    private readonly battlesRepo: Repository<Battle>,
    @InjectRepository(BattleParticipant)
    private readonly participantsRepo: Repository<BattleParticipant>,
    @InjectRepository(BattleQuestion)
    private readonly questionsRepo: Repository<BattleQuestion>,
    @InjectRepository(BattleAnswer)
    private readonly answersRepo: Repository<BattleAnswer>,
    @InjectRepository(BattleCoinEscrow)
    private readonly escrowsRepo: Repository<BattleCoinEscrow>,
    @InjectRepository(BattleEvent)
    private readonly eventsRepo: Repository<BattleEvent>,
    @InjectRepository(BattleResult)
    private readonly resultsRepo: Repository<BattleResult>,
    @InjectRepository(UserLeagueState)
    private readonly leagueStateRepo: Repository<UserLeagueState>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
  ) {}

  async create(userId: string, dto: CreateBattleDto) {
    const existing = await this.battlesRepo.findOne({
      where: { challengerId: userId, createIdempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      return this.getBattle(userId, existing.id);
    }

    if (dto.opponentId === userId) {
      throw new AppException(
        AuthErrorCode.BATTLE_OPPONENT_NOT_ALLOWED,
        'Cannot battle yourself',
        HttpStatus.BAD_REQUEST,
      );
    }

    const opponent = await this.requireEligibleUser(dto.opponentId);
    await this.requireEligibleUser(userId);

    const battleGate = await this.socialPermissions.canBattleInvite(
      userId,
      dto.opponentId,
    );
    if (!battleGate.allowed) {
      throw new AppException(
        AuthErrorCode.BATTLE_OPPONENT_NOT_ALLOWED,
        battleGate.reason === 'blocked'
          ? 'Opponent not available'
          : 'Battle invites are friends-only',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.assertNoConflictingBattle(userId);
    await this.assertNoConflictingBattle(dto.opponentId);
    await this.assertRiskClear(userId);
    await this.assertRiskClear(dto.opponentId);

    const challengerRank = await this.rankLevelFor(userId);
    const opponentRank = await this.rankLevelFor(dto.opponentId);
    const maxStake = Math.min(
      maxStakeForRankLevel(challengerRank),
      maxStakeForRankLevel(opponentRank),
    );
    if (dto.stake > maxStake) {
      throw new AppException(
        AuthErrorCode.BATTLE_STAKE_LIMIT,
        `Max stake for this matchup is ${maxStake}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.assertWalletCoins(userId, dto.stake);

    const difficultyMix =
      dto.difficulty === 'mixed'
        ? ['easy', 'medium', 'hard', 'expert']
        : [dto.difficulty];

    const exposure = await this.loadExposureHistories(userId, dto.opponentId);

    // Validate pool availability before invite (no debit yet).
    try {
      await this.questionPool.selectBattleSet({
        subject: dto.subject.toLowerCase().replace(/\s+/g, '-'),
        topic: dto.topic,
        count: dto.questions,
        difficultyMix,
        mode: dto.mode,
        userExposureHistory: exposure.user,
        opponentExposureHistory: exposure.opponent,
      });
    } catch (err) {
      if (err instanceof AppException) {
        throw new AppException(
          AuthErrorCode.BATTLE_INSUFFICIENT_QUESTION_POOL,
          err.message,
          HttpStatus.BAD_REQUEST,
        );
      }
      throw err;
    }

    const challengerProfile = await this.profiles.findByUserId(userId);

    const ttl =
      dto.mode === BattleMode.Live
        ? BATTLE_LIVE_INVITE_TTL_MS
        : BATTLE_ASYNC_INVITE_TTL_MS;

    const battle = await this.dataSource.transaction(async (manager) => {
      const battleRepo = manager.getRepository(Battle);
      const partRepo = manager.getRepository(BattleParticipant);

      const row = await battleRepo.save(
        battleRepo.create({
          challengerId: userId,
          opponentId: opponent.id,
          subject: dto.subject,
          topic: dto.topic ?? null,
          difficulty: dto.difficulty,
          mode: dto.mode,
          questionCount: dto.questions,
          secondsPerQuestion: dto.secondsPerQuestion,
          stakePerPlayer: dto.stake,
          status: BattleStatus.Invited,
          inviteExpiresAt: new Date(Date.now() + ttl),
          createIdempotencyKey: dto.idempotencyKey,
          currentRound: 0,
        }),
      );

      await partRepo.save([
        partRepo.create({
          battleId: row.id,
          userId,
          role: BattleParticipantRole.Challenger,
        }),
        partRepo.create({
          battleId: row.id,
          userId: opponent.id,
          role: BattleParticipantRole.Opponent,
        }),
      ]);

      await this.appendEvent(manager, row.id, BattleEventType.Invite, userId, {
        stake: dto.stake,
        subject: dto.subject,
      });

      return row;
    });

    const challengerName =
      challengerProfile?.displayName ||
      challengerProfile?.username ||
      'Someone';

    await this.notifications.create({
      userId: opponent.id,
      type: NotificationType.BattleInvite,
      title: 'Battle challenge',
      body: `${challengerName} challenged you to ${dto.questions} ${dto.subject} questions for ${dto.stake} Coins.`,
      actionUrl: `/battle/invite/${battle.id}`,
      payload: { battleId: battle.id },
      dedupeKey: `battle_invite:${battle.id}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });

    return this.getBattle(userId, battle.id);
  }

  async listInvites(userId: string) {
    await this.runMaintenance();
    const battles = await this.battlesRepo.find({
      where: [
        { opponentId: userId, status: In(ACTIVE_STATUSES) },
        { challengerId: userId, status: In(ACTIVE_STATUSES) },
      ],
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    // Deduplicate (user can match both where clauses only if self-battle — still safe).
    const seen = new Set<string>();
    const unique = battles.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
    return {
      items: await Promise.all(unique.map((b) => this.getBattle(userId, b.id))),
    };
  }

  async accept(userId: string, battleId: string, idempotencyKey: string) {
    await this.runMaintenance();
    return this.dataSource
      .transaction(async (manager) => {
        const battleRepo = manager.getRepository(Battle);
        const battle = await battleRepo.findOne({
          where: { id: battleId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!battle) {
          throw new AppException(
            AuthErrorCode.BATTLE_NOT_FOUND,
            'Battle not found',
            HttpStatus.NOT_FOUND,
          );
        }
        if (battle.opponentId !== userId) {
          throw new AppException(
            AuthErrorCode.BATTLE_NOT_PARTICIPANT,
            'Only opponent can accept',
            HttpStatus.FORBIDDEN,
          );
        }
        if (battle.status !== BattleStatus.Invited) {
          if (
            [
              BattleStatus.Accepted,
              BattleStatus.Funding,
              BattleStatus.Ready,
              BattleStatus.InProgress,
            ].includes(battle.status)
          ) {
            return this.serializeBattle(userId, battle.id, manager);
          }
          throw new AppException(
            AuthErrorCode.BATTLE_INVALID_STATE,
            `Cannot accept from ${battle.status}`,
            HttpStatus.BAD_REQUEST,
          );
        }
        if (battle.inviteExpiresAt && battle.inviteExpiresAt < new Date()) {
          battle.status = BattleStatus.Expired;
          await battleRepo.save(battle);
          throw new AppException(
            AuthErrorCode.BATTLE_INVITE_EXPIRED,
            'Invite expired',
            HttpStatus.BAD_REQUEST,
          );
        }

        await this.requireEligibleUser(battle.challengerId);
        await this.requireEligibleUser(battle.opponentId);
        await this.assertRiskClear(battle.challengerId);
        await this.assertRiskClear(battle.opponentId);

        const challengerRank = await this.rankLevelFor(battle.challengerId);
        const opponentRank = await this.rankLevelFor(battle.opponentId);
        const maxStake = Math.min(
          maxStakeForRankLevel(challengerRank),
          maxStakeForRankLevel(opponentRank),
        );
        if (battle.stakePerPlayer > maxStake) {
          throw new AppException(
            AuthErrorCode.BATTLE_STAKE_LIMIT,
            `Max stake for this matchup is ${maxStake}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        battle.status = BattleStatus.Accepted;
        await battleRepo.save(battle);

        battle.status = BattleStatus.Funding;
        await battleRepo.save(battle);

        const settlementId = randomUUID();
        const challengerDebit = await this.ledgerDebitCoins(
          manager,
          battle.challengerId,
          battle.stakePerPlayer,
          battle.id,
          'escrow_challenger',
          settlementId,
        );
        const opponentDebit = await this.ledgerDebitCoins(
          manager,
          battle.opponentId,
          battle.stakePerPlayer,
          battle.id,
          'escrow_opponent',
          settlementId,
        );

        const escrowRepo = manager.getRepository(BattleCoinEscrow);
        await escrowRepo.save([
          escrowRepo.create({
            battleId: battle.id,
            userId: battle.challengerId,
            amount: battle.stakePerPlayer,
            debitLedgerEntryId: challengerDebit,
            status: BattleEscrowStatus.Reserved,
            settlementTransactionId: settlementId,
          }),
          escrowRepo.create({
            battleId: battle.id,
            userId: battle.opponentId,
            amount: battle.stakePerPlayer,
            debitLedgerEntryId: opponentDebit,
            status: BattleEscrowStatus.Reserved,
            settlementTransactionId: settlementId,
          }),
        ]);

        const difficultyMix =
          battle.difficulty === 'mixed'
            ? ['easy', 'medium', 'hard', 'expert']
            : [battle.difficulty];

        const exposure = await this.loadExposureHistories(
          battle.challengerId,
          battle.opponentId,
        );

        let questionSet;
        try {
          questionSet = await this.questionPool.selectBattleSet({
            subject: battle.subject.toLowerCase().replace(/\s+/g, '-'),
            topic: battle.topic ?? undefined,
            count: battle.questionCount,
            difficultyMix,
            mode: battle.mode,
            userExposureHistory: exposure.user,
            opponentExposureHistory: exposure.opponent,
          });
        } catch (err) {
          // Refund and void if pool failed after debit.
          await this.refundEscrows(manager, battle);
          battle.status = BattleStatus.Voided;
          battle.resultReason = BattleResultReason.Void;
          await battleRepo.save(battle);
          throw new AppException(
            AuthErrorCode.BATTLE_INSUFFICIENT_QUESTION_POOL,
            err instanceof Error ? err.message : 'Question pool too small',
            HttpStatus.BAD_REQUEST,
          );
        }

        const qRepo = manager.getRepository(BattleQuestion);
        const timeLimitMs = battle.secondsPerQuestion * 1000;
        const rows = questionSet.questions.map((snap, i) =>
          qRepo.create({
            battleId: battle.id,
            round: 1,
            orderIndex: i + 1,
            isSuddenDeath: false,
            questionTemplateId: snap.questionTemplateId,
            questionVersionId: snap.questionVersionId,
            prompt: snap.prompt,
            options: snap.options,
            correctOptionIds: snap.correctOptionIds,
            explanation: snap.explanation,
            difficulty: snap.difficulty,
            timeLimitMs,
          }),
        );
        await qRepo.save(rows);

        battle.status = BattleStatus.Ready;
        battle.startedAt = new Date();
        if (battle.mode === BattleMode.Async) {
          battle.playExpiresAt = new Date(
            Date.now() + BATTLE_ASYNC_PLAY_TTL_MS,
          );
        }
        await battleRepo.save(battle);

        await this.appendEvent(
          manager,
          battle.id,
          BattleEventType.Accepted,
          userId,
          { idempotencyKey },
        );

        return this.serializeBattle(userId, battle.id, manager);
      })
      .then(async (dto) => {
        const battle = await this.battlesRepo.findOneBy({ id: battleId });
        if (battle) {
          await this.notifications.create({
            userId: battle.challengerId,
            type: NotificationType.BattleAccepted,
            title: 'Battle accepted',
            body: 'Your opponent accepted. Get ready!',
            actionUrl: `/battle/play/${battleId}`,
            payload: { battleId },
          });
        }
        return dto;
      });
  }

  async decline(userId: string, battleId: string, idempotencyKey: string) {
    const battle = await this.requireParticipantBattle(userId, battleId);
    if (battle.status !== BattleStatus.Invited) {
      throw new AppException(
        AuthErrorCode.BATTLE_INVALID_STATE,
        'Invite not open',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (battle.opponentId !== userId && battle.challengerId !== userId) {
      throw new AppException(
        AuthErrorCode.BATTLE_NOT_PARTICIPANT,
        'Not a participant',
        HttpStatus.FORBIDDEN,
      );
    }
    battle.status =
      battle.challengerId === userId
        ? BattleStatus.Cancelled
        : BattleStatus.Declined;
    await this.battlesRepo.save(battle);
    await this.appendEvent(
      this.dataSource.manager,
      battle.id,
      BattleEventType.Result,
      userId,
      { status: battle.status, idempotencyKey },
    );

    const otherId =
      battle.challengerId === userId ? battle.opponentId : battle.challengerId;
    const actor = await this.profilesRepo.findOneBy({ userId });
    const actorName =
      actor?.displayName || actor?.username || 'Your rival';
    const cancelledByChallenger = battle.status === BattleStatus.Cancelled;
    await this.notifications.create({
      userId: otherId,
      type: NotificationType.BattleInvite,
      title: cancelledByChallenger ? 'Invite cancelled' : 'Invite declined',
      body: cancelledByChallenger
        ? `${actorName} cancelled the battle invite.`
        : `${actorName} declined the battle invite.`,
      actionUrl: '/battle',
      payload: { battleId, status: battle.status },
      dedupeKey: `battle_invite_closed:${battle.id}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });

    return this.getBattle(userId, battleId);
  }

  async cancel(userId: string, battleId: string, idempotencyKey: string) {
    return this.decline(userId, battleId, idempotencyKey);
  }

  async ready(userId: string, battleId: string, idempotencyKey: string) {
    return this.dataSource.transaction(async (manager) => {
      const battle = await manager.getRepository(Battle).findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!battle) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_FOUND,
          'Battle not found',
          HttpStatus.NOT_FOUND,
        );
      }
      this.assertParticipant(battle, userId);
      if (
        ![BattleStatus.Ready, BattleStatus.Accepted].includes(battle.status)
      ) {
        if (
          [BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
            battle.status,
          )
        ) {
          return this.serializeBattle(userId, battleId, manager);
        }
        throw new AppException(
          AuthErrorCode.BATTLE_INVALID_STATE,
          `Cannot ready from ${battle.status}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const partRepo = manager.getRepository(BattleParticipant);
      const me = await partRepo.findOne({
        where: { battleId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!me) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_PARTICIPANT,
          'Not a participant',
          HttpStatus.FORBIDDEN,
        );
      }
      me.isReady = true;
      me.connectionState = 'online';
      me.lastHeartbeatAt = new Date();
      await partRepo.save(me);

      await this.appendEvent(
        manager,
        battleId,
        BattleEventType.PlayerReady,
        userId,
        { idempotencyKey },
      );

      const parts = await partRepo.find({ where: { battleId } });
      if (parts.every((p) => p.isReady)) {
        battle.status = BattleStatus.InProgress;
        battle.currentRound = 1;
        await manager.getRepository(Battle).save(battle);
        await this.openQuestion(manager, battle, 1);
        const challengerId = battle.challengerId;
        const opponentId = battle.opponentId;
        this.afterCommit(async () => {
          await this.notifications.create({
            userId: challengerId,
            type: NotificationType.BattleStarting,
            title: 'Battle starting',
            body: 'Both players ready — first question is live.',
            actionUrl: `/battle/play/${battleId}`,
            payload: { battleId },
          });
          await this.notifications.create({
            userId: opponentId,
            type: NotificationType.BattleStarting,
            title: 'Battle starting',
            body: 'Both players ready — first question is live.',
            actionUrl: `/battle/play/${battleId}`,
            payload: { battleId },
          });
        });
      }

      return this.serializeBattle(userId, battleId, manager);
    });
  }

  async getBattle(userId: string, battleId: string) {
    await this.runMaintenance();
    await this.maybeTimeoutCurrentQuestion(battleId);
    await this.enforceDisconnectRules(battleId);
    await this.maybeAutoContinueAfterReveal(battleId);
    return this.serializeBattle(userId, battleId);
  }

  /**
   * After a revealed question, open the next round (or settle if finished).
   * Reveal stays on the current question until clients call this.
   */
  async continuePlay(userId: string, battleId: string) {
    return this.dataSource.transaction(async (manager) => {
      const battle = await manager.getRepository(Battle).findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!battle) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_FOUND,
          'Battle not found',
          HttpStatus.NOT_FOUND,
        );
      }
      this.assertParticipant(battle, userId);
      if (
        ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
          battle.status,
        )
      ) {
        return this.serializeBattle(userId, battleId, manager);
      }

      const qRepo = manager.getRepository(BattleQuestion);
      const current = await qRepo.findOne({
        where: { battleId, orderIndex: battle.currentRound },
      });
      if (!current?.revealedAt) {
        return this.serializeBattle(userId, battleId, manager);
      }

      if (battle.status === BattleStatus.InProgress) {
        const normalQs = await qRepo.find({
          where: { battleId, isSuddenDeath: false },
          order: { orderIndex: 'ASC' },
        });
        const next = normalQs.find((q) => !q.revealedAt && !q.openedAt);
        if (next) {
          battle.currentRound = next.orderIndex;
          await manager.getRepository(Battle).save(battle);
          await this.openQuestion(manager, battle, next.orderIndex);
          return this.serializeBattle(userId, battleId, manager);
        }
        // Last normal question revealed — settle / sudden death.
        await this.advanceAfterReveal(manager, battle);
        return this.serializeBattle(userId, battleId, manager);
      }

      // Sudden death: if still tied after reveal, open another SD question.
      await this.advanceAfterReveal(manager, battle);
      return this.serializeBattle(userId, battleId, manager);
    });
  }

  async heartbeat(userId: string, battleId: string) {
    await this.requireParticipantBattle(userId, battleId);
    const part = await this.participantsRepo.findOne({
      where: { battleId, userId },
    });
    if (!part) {
      throw new AppException(
        AuthErrorCode.BATTLE_NOT_PARTICIPANT,
        'Not a participant',
        HttpStatus.FORBIDDEN,
      );
    }
    part.lastHeartbeatAt = new Date();
    part.connectionState = 'online';
    await this.participantsRepo.save(part);
    await this.enforceDisconnectRules(battleId);
    return this.serializeBattle(userId, battleId);
  }

  async getState(userId: string, battleId: string) {
    return this.getBattle(userId, battleId);
  }

  async submitAnswer(
    userId: string,
    battleId: string,
    dto: SubmitBattleAnswerDto,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const battle = await manager.getRepository(Battle).findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!battle) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_FOUND,
          'Battle not found',
          HttpStatus.NOT_FOUND,
        );
      }
      this.assertParticipant(battle, userId);
      if (
        ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
          battle.status,
        )
      ) {
        throw new AppException(
          AuthErrorCode.BATTLE_ALREADY_STARTED,
          `Battle is ${battle.status}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const existingByKey = await manager.getRepository(BattleAnswer).findOne({
        where: {
          idempotencyKey: answerIdempotencyKey(userId, dto.idempotencyKey),
        },
      });
      if (existingByKey) {
        return this.serializeBattle(userId, battleId, manager);
      }

      const question = await manager.getRepository(BattleQuestion).findOne({
        where: { id: dto.battleQuestionId, battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!question) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_FOUND,
          'Question not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (!question.openedAt) {
        throw new AppException(
          AuthErrorCode.BATTLE_INVALID_STATE,
          'Question not open',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (question.revealedAt) {
        throw new AppException(
          AuthErrorCode.BATTLE_ANSWER_ALREADY_SUBMITTED,
          'Question already revealed',
          HttpStatus.BAD_REQUEST,
        );
      }

      const elapsed = Date.now() - question.openedAt.getTime();
      const timedOut = Boolean(dto.timedOut) || elapsed > question.timeLimitMs;
      if (timedOut && elapsed > question.timeLimitMs + 5_000) {
        // Soft expire — still accept as timeout answer.
      }

      const partRepo = manager.getRepository(BattleParticipant);
      const me = await partRepo.findOne({
        where: { battleId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!me) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_PARTICIPANT,
          'Not a participant',
          HttpStatus.FORBIDDEN,
        );
      }

      const prior = await manager.getRepository(BattleAnswer).findOne({
        where: { participantId: me.id, battleQuestionId: question.id },
      });
      if (prior) {
        // Idempotent retry after a successful submit.
        return this.serializeBattle(userId, battleId, manager);
      }

      const selected = timedOut ? null : (dto.selectedOptionId ?? null);
      const isCorrect =
        !timedOut &&
        selected != null &&
        question.correctOptionIds.includes(selected);

      const responseMs = Math.min(
        dto.responseMs,
        question.timeLimitMs,
        Math.max(0, elapsed),
      );

      const breakdown = scoreBattleAnswer({
        isCorrect,
        responseMs,
        timeLimitMs: question.timeLimitMs,
        difficulty: question.difficulty,
        correctStreakBefore: me.correctStreak,
      });

      const answer = await manager.getRepository(BattleAnswer).save(
        manager.getRepository(BattleAnswer).create({
          participantId: me.id,
          battleQuestionId: question.id,
          selectedOptionId: selected,
          isCorrect,
          responseMs,
          correctnessPoints: breakdown.correctnessPoints,
          speedBonus: breakdown.speedBonus,
          difficultyBonus: breakdown.difficultyBonus,
          streakBonus: breakdown.streakBonus,
          questionScore: breakdown.questionScore,
          timedOut,
          idempotencyKey: answerIdempotencyKey(userId, dto.idempotencyKey),
          submittedAt: new Date(),
        }),
      );

      me.score += breakdown.questionScore;
      me.answerCount += 1;
      me.totalAnswerMs += responseMs;
      if (isCorrect) {
        me.correctCount += 1;
        me.correctStreak += 1;
        if (
          question.difficulty === 'hard' ||
          question.difficulty === 'expert'
        ) {
          me.hardExpertCorrect += 1;
        }
      } else {
        me.correctStreak = 0;
      }
      await partRepo.save(me);

      if (battle.challengerId === userId) {
        battle.challengerScore = me.score;
      } else {
        battle.opponentScore = me.score;
      }
      await manager.getRepository(Battle).save(battle);

      await this.appendEvent(
        manager,
        battleId,
        BattleEventType.AnswerSubmitted,
        userId,
        { questionId: question.id, answerId: answer.id },
      );

      const parts = await partRepo.find({ where: { battleId } });
      const answers = await manager.getRepository(BattleAnswer).find({
        where: {
          battleQuestionId: question.id,
          participantId: In(parts.map((p) => p.id)),
        },
      });

      const bothAnswered = parts.every((p) =>
        answers.some((a) => a.participantId === p.id),
      );
      const expired = elapsed >= question.timeLimitMs;

      if (
        bothAnswered ||
        (expired && answers.length >= 1 && battle.mode === BattleMode.Live)
      ) {
        // Auto-timeout missing answers on live.
        if (!bothAnswered && battle.mode === BattleMode.Live) {
          for (const p of parts) {
            if (answers.some((a) => a.participantId === p.id)) continue;
            const auto = scoreBattleAnswer({
              isCorrect: false,
              responseMs: question.timeLimitMs,
              timeLimitMs: question.timeLimitMs,
              difficulty: question.difficulty,
              correctStreakBefore: p.correctStreak,
            });
            await manager.getRepository(BattleAnswer).save(
              manager.getRepository(BattleAnswer).create({
                participantId: p.id,
                battleQuestionId: question.id,
                selectedOptionId: null,
                isCorrect: false,
                responseMs: question.timeLimitMs,
                ...auto,
                timedOut: true,
                idempotencyKey: timeoutAnswerIdemKey(question.id, p.id),
                submittedAt: new Date(),
              }),
            );
            p.correctStreak = 0;
            p.answerCount += 1;
            p.totalAnswerMs += question.timeLimitMs;
            await partRepo.save(p);
          }
        }

        question.revealedAt = new Date();
        await manager.getRepository(BattleQuestion).save(question);
        await this.appendEvent(
          manager,
          battleId,
          BattleEventType.Reveal,
          null,
          { questionId: question.id },
        );

        await this.advanceAfterReveal(manager, battle);
      }

      return this.serializeBattle(userId, battleId, manager);
    });
  }

  async forfeit(userId: string, battleId: string, idempotencyKey: string) {
    return this.dataSource.transaction(async (manager) => {
      const battle = await manager.getRepository(Battle).findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!battle) {
        throw new AppException(
          AuthErrorCode.BATTLE_NOT_FOUND,
          'Battle not found',
          HttpStatus.NOT_FOUND,
        );
      }
      this.assertParticipant(battle, userId);
      if (
        ![
          BattleStatus.Ready,
          BattleStatus.InProgress,
          BattleStatus.SuddenDeath,
        ].includes(battle.status)
      ) {
        throw new AppException(
          AuthErrorCode.BATTLE_INVALID_STATE,
          'Cannot forfeit now',
          HttpStatus.BAD_REQUEST,
        );
      }

      const winnerId =
        battle.challengerId === userId
          ? battle.opponentId
          : battle.challengerId;

      const partRepo = manager.getRepository(BattleParticipant);
      const me = await partRepo.findOneBy({ battleId, userId });
      if (me) {
        me.forfeited = true;
        await partRepo.save(me);
      }

      await this.settleWinner(
        manager,
        battle,
        winnerId,
        BattleResultReason.Forfeit,
      );
      await this.appendEvent(
        manager,
        battleId,
        BattleEventType.Result,
        userId,
        { reason: 'forfeit', idempotencyKey },
      );
      return this.serializeBattle(userId, battleId, manager);
    });
  }

  async rematch(userId: string, battleId: string, idempotencyKey: string) {
    const prior = await this.requireParticipantBattle(userId, battleId);
    if (
      ![
        BattleStatus.Completed,
        BattleStatus.Forfeited,
        BattleStatus.Refunded,
      ].includes(prior.status)
    ) {
      throw new AppException(
        AuthErrorCode.BATTLE_INVALID_STATE,
        'Rematch only after finished battle',
        HttpStatus.BAD_REQUEST,
      );
    }
    const opponentId =
      prior.challengerId === userId ? prior.opponentId : prior.challengerId;

    const created = await this.create(userId, {
      opponentId,
      subject: prior.subject,
      topic: prior.topic ?? undefined,
      difficulty: prior.difficulty,
      questions: prior.questionCount,
      secondsPerQuestion: prior.secondsPerQuestion,
      mode: prior.mode,
      stake: prior.stakePerPlayer,
      idempotencyKey,
    });

    await this.notifications.create({
      userId: opponentId,
      type: NotificationType.BattleRematch,
      title: 'Rematch request',
      body: 'Your rival wants a rematch.',
      actionUrl: `/battle/invite/${created.id}`,
      payload: { battleId: created.id },
    });

    return created;
  }

  async history(userId: string, cursor?: string) {
    const take = 20;
    const qb = this.resultsRepo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId })
      .orderBy('r.created_at', 'DESC')
      .take(take + 1);

    if (cursor) {
      qb.andWhere('r.created_at < :cursor', {
        cursor: new Date(cursor),
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map(toHistoryItemDto),
      nextCursor: hasMore
        ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
        : null,
    };
  }

  async statsMe(userId: string) {
    const rows = await this.resultsRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const played = rows.length;
    const wins = rows.filter((r) => r.result === 'win').length;
    const losses = rows.filter((r) => r.result === 'loss').length;
    const draws = rows.filter((r) => r.result === 'draw').length;
    const winRate = played ? Math.round((wins / played) * 100) : 0;

    let winStreak = 0;
    for (const r of rows) {
      if (r.result === 'win') winStreak += 1;
      else break;
    }

    const subjectCounts = new Map<string, number>();
    for (const r of rows) {
      subjectCounts.set(r.subject, (subjectCounts.get(r.subject) ?? 0) + 1);
    }
    let favoriteSubject = '—';
    let best = 0;
    for (const [s, n] of subjectCounts) {
      if (n > best) {
        best = n;
        favoriteSubject = s;
      }
    }

    const topicCounts = new Map<string, number>();
    for (const r of rows) {
      if (!r.topic) continue;
      topicCounts.set(r.topic, (topicCounts.get(r.topic) ?? 0) + 1);
    }
    let bestTopic: string | null = null;
    let topicBest = 0;
    for (const [t, n] of topicCounts) {
      if (n > topicBest) {
        topicBest = n;
        bestTopic = t;
      }
    }

    return {
      played,
      wins,
      losses,
      draws,
      winRate,
      winStreak,
      favoriteSubject,
      bestTopic,
    };
  }

  // ─── internals ───────────────────────────────────────────────

  private async advanceAfterReveal(
    manager: DataSource['manager'],
    battle: Battle,
  ) {
    const battleRepo = manager.getRepository(Battle);
    const qRepo = manager.getRepository(BattleQuestion);

    const normalQs = await qRepo.find({
      where: { battleId: battle.id, isSuddenDeath: false },
      order: { orderIndex: 'ASC' },
    });
    const allNormalRevealed = normalQs.every((q) => q.revealedAt);

    if (battle.status === BattleStatus.InProgress && !allNormalRevealed) {
      // Stay on revealed question so clients can show answer reveal.
      // Next question opens via continuePlay.
      return;
    }

    if (battle.status === BattleStatus.InProgress && allNormalRevealed) {
      if (battle.challengerScore === battle.opponentScore) {
        battle.status = BattleStatus.SuddenDeath;
        battle.suddenDeathCount = 0;
        await battleRepo.save(battle);
        await this.appendEvent(
          manager,
          battle.id,
          BattleEventType.SuddenDeath,
          null,
          {},
        );
        await this.openSuddenDeathQuestion(manager, battle);
        return;
      }
      const winnerId =
        battle.challengerScore > battle.opponentScore
          ? battle.challengerId
          : battle.opponentId;
      await this.settleWinner(
        manager,
        battle,
        winnerId,
        BattleResultReason.Score,
      );
      return;
    }

    if (battle.status === BattleStatus.SuddenDeath) {
      const sdQs = await qRepo.find({
        where: { battleId: battle.id, isSuddenDeath: true },
        order: { orderIndex: 'ASC' },
      });
      const last = sdQs[sdQs.length - 1];
      if (last?.revealedAt) {
        const answers = await manager.getRepository(BattleAnswer).find({
          where: { battleQuestionId: last.id },
        });
        const parts = await manager.getRepository(BattleParticipant).find({
          where: { battleId: battle.id },
        });
        const byPart = new Map(answers.map((a) => [a.participantId, a]));
        const c = parts.find(
          (p) => p.role === BattleParticipantRole.Challenger,
        )!;
        const o = parts.find((p) => p.role === BattleParticipantRole.Opponent)!;
        const ca = byPart.get(c.id);
        const oa = byPart.get(o.id);
        if (ca && oa && ca.isCorrect !== oa.isCorrect) {
          const winnerId = ca.isCorrect ? c.userId : o.userId;
          await this.settleWinner(
            manager,
            battle,
            winnerId,
            BattleResultReason.SuddenDeath,
          );
          return;
        }
      }

      if (battle.suddenDeathCount >= BATTLE_SUDDEN_DEATH_MAX) {
        await this.applyTiebreakers(manager, battle);
        return;
      }
      await this.openSuddenDeathQuestion(manager, battle);
    }
  }

  private async applyTiebreakers(
    manager: DataSource['manager'],
    battle: Battle,
  ) {
    const parts = await manager.getRepository(BattleParticipant).find({
      where: { battleId: battle.id },
    });
    const c = parts.find((p) => p.role === BattleParticipantRole.Challenger)!;
    const o = parts.find((p) => p.role === BattleParticipantRole.Opponent)!;

    if (c.hardExpertCorrect !== o.hardExpertCorrect) {
      const winnerId =
        c.hardExpertCorrect > o.hardExpertCorrect ? c.userId : o.userId;
      await this.settleWinner(
        manager,
        battle,
        winnerId,
        BattleResultReason.Tiebreakers,
      );
      return;
    }

    const cAcc = c.answerCount ? c.correctCount / c.answerCount : 0;
    const oAcc = o.answerCount ? o.correctCount / o.answerCount : 0;
    if (cAcc !== oAcc) {
      const winnerId = cAcc > oAcc ? c.userId : o.userId;
      await this.settleWinner(
        manager,
        battle,
        winnerId,
        BattleResultReason.Tiebreakers,
      );
      return;
    }

    const cAvg = c.answerCount ? c.totalAnswerMs / c.answerCount : Infinity;
    const oAvg = o.answerCount ? o.totalAnswerMs / o.answerCount : Infinity;
    if (cAvg !== oAvg) {
      const winnerId = cAvg < oAvg ? c.userId : o.userId;
      await this.settleWinner(
        manager,
        battle,
        winnerId,
        BattleResultReason.Tiebreakers,
      );
      return;
    }

    await this.settleDraw(manager, battle);
  }

  private async settleWinner(
    manager: DataSource['manager'],
    battle: Battle,
    winnerId: string,
    reason: BattleResultReason,
  ) {
    const battleRepo = manager.getRepository(Battle);
    const escrowRepo = manager.getRepository(BattleCoinEscrow);
    const pot = battle.stakePerPlayer * 2;
    const escrows = await escrowRepo.find({ where: { battleId: battle.id } });

    try {
      await this.ledgerCreditCoins(
        manager,
        winnerId,
        pot,
        battle.id,
        'pot_win',
        escrows[0]?.settlementTransactionId ?? battle.id,
      );
    } catch (err) {
      this.logger.error(`Settlement credit failed for ${battle.id}`, err);
      throw new AppException(
        AuthErrorCode.BATTLE_SETTLEMENT_FAILED,
        'Settlement failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    for (const e of escrows) {
      e.status = BattleEscrowStatus.Captured;
      await escrowRepo.save(e);
    }

    const isForfeit = reason === BattleResultReason.Forfeit;
    battle.status = isForfeit ? BattleStatus.Forfeited : BattleStatus.Completed;
    battle.winnerId = winnerId;
    battle.resultReason = reason;
    battle.endedAt = new Date();
    await battleRepo.save(battle);

    const parts = await manager.getRepository(BattleParticipant).find({
      where: { battleId: battle.id },
    });
    for (const p of parts) {
      p.finalPlacement = p.userId === winnerId ? 1 : 2;
      await manager.getRepository(BattleParticipant).save(p);
      await this.writeResultAndRewards(manager, battle, p, winnerId);
    }

    await this.appendEvent(manager, battle.id, BattleEventType.Result, null, {
      winnerId,
      reason,
    });

    const loserId =
      winnerId === battle.challengerId
        ? battle.opponentId
        : battle.challengerId;
    const battleId = battle.id;
    // Must run after commit — these services use other pool connections and
    // deadlock when awaited while this tx still holds wallet/battle locks.
    this.afterCommit(async () => {
      await this.notifications.create({
        userId: winnerId,
        type: NotificationType.BattleResult,
        title: 'Victory',
        body: `${pot} Coins added to your balance.`,
        actionUrl: `/battle/result/${battleId}`,
        payload: { battleId },
      });
      await this.notifications.create({
        userId: loserId,
        type: NotificationType.BattleResult,
        title: 'Battle ended',
        body: 'Tough match — rematch when ready.',
        actionUrl: `/battle/result/${battleId}`,
        payload: { battleId },
      });
      await this.recordBattleQualitySamples(battleId);
      await this.badges?.onDomainEvent({
        type: OUTBOX_BATTLE_COMPLETED,
        payload: {
          userId: winnerId,
          won: true,
          battleId,
          isWinner: true,
        },
      });
    });
  }

  private async settleDraw(manager: DataSource['manager'], battle: Battle) {
    await this.refundEscrows(manager, battle);
    battle.status = BattleStatus.Refunded;
    battle.winnerId = null;
    battle.resultReason = BattleResultReason.Draw;
    battle.endedAt = new Date();
    await manager.getRepository(Battle).save(battle);

    const parts = await manager.getRepository(BattleParticipant).find({
      where: { battleId: battle.id },
    });
    for (const p of parts) {
      p.finalPlacement = 1;
      await manager.getRepository(BattleParticipant).save(p);
      await this.writeResultAndRewards(manager, battle, p, null);
    }
    await this.appendEvent(manager, battle.id, BattleEventType.Result, null, {
      reason: 'draw',
    });

    const battleId = battle.id;
    this.afterCommit(async () => {
      await this.recordBattleQualitySamples(battleId);
    });
  }

  /**
   * Schedule work for after the ambient TypeORM transaction commits.
   * setImmediate runs as a macrotask after commit finishes (unlike microtasks).
   */
  private afterCommit(task: () => Promise<void>) {
    setImmediate(() => {
      void task().catch((err) =>
        this.logger.warn(
          `Battle after-commit side effect failed: ${
            err instanceof Error ? err.message : err
          }`,
        ),
      );
    });
  }

  private async recordBattleQualitySamples(battleId: string): Promise<void> {
    const questions = await this.questionsRepo.find({
      where: { battleId },
    });
    if (!questions.length) return;

    const byId = new Map(questions.map((q) => [q.id, q]));
    const answers = await this.answersRepo
      .createQueryBuilder('a')
      .where('a.battle_question_id IN (:...ids)', {
        ids: questions.map((q) => q.id),
      })
      .getMany();
    for (const a of answers) {
      const q = byId.get(a.battleQuestionId);
      if (!q) continue;
      try {
        await this.contentQuality.recordBattleSample({
          questionTemplateId: q.questionTemplateId,
          correct: a.isCorrect,
          responseMs: a.responseMs,
        });
      } catch {
        /* quality optional */
      }
    }
  }

  private async refundEscrows(manager: DataSource['manager'], battle: Battle) {
    const escrowRepo = manager.getRepository(BattleCoinEscrow);
    const escrows = await escrowRepo.find({ where: { battleId: battle.id } });
    for (const e of escrows) {
      if (
        e.status === BattleEscrowStatus.Refunded ||
        e.status === BattleEscrowStatus.Captured
      ) {
        continue;
      }
      await this.ledgerCreditCoins(
        manager,
        e.userId,
        e.amount,
        battle.id,
        `refund:${e.userId}`,
        e.settlementTransactionId ?? battle.id,
      );
      e.status = BattleEscrowStatus.Refunded;
      await escrowRepo.save(e);
    }
  }

  private async writeResultAndRewards(
    manager: DataSource['manager'],
    battle: Battle,
    participant: BattleParticipant,
    winnerId: string | null,
  ) {
    const opponentId =
      participant.userId === battle.challengerId
        ? battle.opponentId
        : battle.challengerId;
    const oppProfile = await manager.getRepository(Profile).findOne({
      where: { userId: opponentId },
    });
    const yourScore =
      participant.userId === battle.challengerId
        ? battle.challengerScore
        : battle.opponentScore;
    const theirScore =
      participant.userId === battle.challengerId
        ? battle.opponentScore
        : battle.challengerScore;

    let result: 'win' | 'loss' | 'draw' = 'draw';
    let coinsDelta = 0;
    if (winnerId == null) {
      result = 'draw';
      coinsDelta = 0; // refund already restored stake
    } else if (winnerId === participant.userId) {
      result = 'win';
      coinsDelta = battle.stakePerPlayer; // net +stake (pot - own stake)
    } else {
      result = 'loss';
      coinsDelta = -battle.stakePerPlayer;
    }

    const accuracy = participant.answerCount
      ? Math.round((participant.correctCount / participant.answerCount) * 100)
      : 0;
    const avgAnswerMs = participant.answerCount
      ? Math.round(participant.totalAnswerMs / participant.answerCount)
      : 0;

    let xp =
      BATTLE_COMPLETION_XP + participant.correctCount * BATTLE_CORRECT_XP;
    if (result === 'win') xp += BATTLE_WIN_XP;
    if (
      participant.correctCount === battle.questionCount &&
      battle.questionCount > 0
    ) {
      xp += BATTLE_PERFECT_XP;
    }

    const pairCount = await this.countPairBattlesToday(
      manager,
      battle.challengerId,
      battle.opponentId,
    );
    if (pairCount > BATTLE_PAIR_XP_DAILY_CAP) {
      xp = 0;
    }

    const participationCoins = await this.participationCoinsAllowed(
      manager,
      participant.userId,
    );

    if (xp > 0 || participationCoins > 0) {
      await this.ledger.grantReward(manager, {
        userId: participant.userId,
        reasonType: RewardReasonType.Battle,
        reasonId: battle.id,
        idempotencyKey: `battle:${battle.id}:${participant.userId}:rewards`,
        lines: [
          {
            currency: RewardCurrency.LifetimeXp,
            amount: xp,
            idempotencySuffix: 'xp',
          },
          {
            currency: RewardCurrency.Coins,
            amount: participationCoins,
            idempotencySuffix: 'participation',
          },
        ],
        metadata: { battleId: battle.id, pairCount },
      });
    }

    const leagueXpToday = await this.battleLeagueXpToday(
      manager,
      participant.userId,
    );
    const leagueDelta = Math.max(
      0,
      Math.min(xp, BATTLE_LEAGUE_XP_DAILY_CAP - leagueXpToday),
    );

    try {
      if (leagueDelta > 0) {
        const grant = await this.ledger.grantReward(manager, {
          userId: participant.userId,
          reasonType: RewardReasonType.Battle,
          reasonId: battle.id,
          idempotencyKey: `battle:${battle.id}:${participant.userId}:league`,
          lines: [
            {
              currency: RewardCurrency.LeagueXp,
              amount: leagueDelta,
              idempotencySuffix: 'league',
            },
          ],
        });
        const leagueIngest = {
          userId: participant.userId,
          ledgerEntryId:
            grant.entryIds[RewardCurrency.LeagueXp] ??
            `${battle.id}:${participant.userId}:league`,
          xpDelta: leagueDelta,
          sourceType: LeagueScoreSourceType.Battle,
          sourceId: battle.id,
          occurredAt: new Date(),
        };
        // Separate pool connection — never await inside this settlement tx.
        this.afterCommit(async () => {
          await this.leagues.ingestQualifiedXp(leagueIngest);
        });
      }
    } catch (err) {
      this.logger.warn(
        `League XP ingest skipped for battle=${battle.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    await manager.getRepository(BattleResult).save(
      manager.getRepository(BattleResult).create({
        battleId: battle.id,
        userId: participant.userId,
        opponentId,
        opponentDisplayName:
          oppProfile?.displayName || oppProfile?.username || 'Rival',
        subject: battle.subject,
        topic: battle.topic,
        result,
        yourScore,
        theirScore,
        stakePerPlayer: battle.stakePerPlayer,
        coinsDelta,
        accuracy,
        avgAnswerMs,
        xpAwarded: xp,
      }),
    );
  }

  private async openQuestion(
    manager: DataSource['manager'],
    battle: Battle,
    orderIndex: number,
  ) {
    const q = await manager.getRepository(BattleQuestion).findOne({
      where: { battleId: battle.id, orderIndex, isSuddenDeath: false },
    });
    if (!q || q.openedAt) return;
    q.openedAt = new Date();
    await manager.getRepository(BattleQuestion).save(q);
    await this.appendEvent(
      manager,
      battle.id,
      BattleEventType.QuestionOpened,
      null,
      { questionId: q.id, orderIndex },
    );
  }

  private async openSuddenDeathQuestion(
    manager: DataSource['manager'],
    battle: Battle,
  ) {
    battle.suddenDeathCount += 1;
    await manager.getRepository(Battle).save(battle);

    const difficultyMix =
      battle.difficulty === 'mixed'
        ? ['hard', 'expert']
        : [battle.difficulty === 'easy' ? 'medium' : battle.difficulty];

    const set = await this.questionPool.selectBattleSet({
      subject: battle.subject.toLowerCase().replace(/\s+/g, '-'),
      topic: battle.topic ?? undefined,
      count: 1,
      difficultyMix,
      mode: battle.mode,
      ...(await this.loadExposureHistories(
        battle.challengerId,
        battle.opponentId,
      ).then((e) => ({
        userExposureHistory: e.user,
        opponentExposureHistory: e.opponent,
      }))),
    });
    const snap = set.questions[0];
    if (!snap) {
      await this.applyTiebreakers(manager, battle);
      return;
    }

    const existing = await manager.getRepository(BattleQuestion).count({
      where: { battleId: battle.id },
    });
    const q = await manager.getRepository(BattleQuestion).save(
      manager.getRepository(BattleQuestion).create({
        battleId: battle.id,
        round: 2,
        orderIndex: existing + 1,
        isSuddenDeath: true,
        questionTemplateId: snap.questionTemplateId,
        questionVersionId: snap.questionVersionId,
        prompt: snap.prompt,
        options: snap.options,
        correctOptionIds: snap.correctOptionIds,
        explanation: snap.explanation,
        difficulty: snap.difficulty,
        timeLimitMs: battle.secondsPerQuestion * 1000,
        openedAt: new Date(),
      }),
    );
    battle.currentRound = q.orderIndex;
    await manager.getRepository(Battle).save(battle);
    await this.appendEvent(
      manager,
      battle.id,
      BattleEventType.QuestionOpened,
      null,
      { questionId: q.id, suddenDeath: true },
    );
  }

  private async maybeTimeoutCurrentQuestion(battleId: string) {
    const battle = await this.battlesRepo.findOneBy({ id: battleId });
    if (
      !battle ||
      ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
        battle.status,
      )
    ) {
      return;
    }
    const q = await this.questionsRepo.findOne({
      where: {
        battleId,
        orderIndex: battle.currentRound,
      },
    });
    if (!q?.openedAt || q.revealedAt) return;
    if (Date.now() - q.openedAt.getTime() < q.timeLimitMs) return;

    // Trigger timeout path via empty transaction settle.
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.getRepository(BattleQuestion).findOne({
        where: { id: q.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.revealedAt) return;
      const parts = await manager.getRepository(BattleParticipant).find({
        where: { battleId },
      });
      const answers = await manager.getRepository(BattleAnswer).find({
        where: { battleQuestionId: locked.id },
      });
      for (const p of parts) {
        if (answers.some((a) => a.participantId === p.id)) continue;
        await manager.getRepository(BattleAnswer).save(
          manager.getRepository(BattleAnswer).create({
            participantId: p.id,
            battleQuestionId: locked.id,
            selectedOptionId: null,
            isCorrect: false,
            responseMs: locked.timeLimitMs,
            correctnessPoints: 0,
            speedBonus: 0,
            difficultyBonus: 0,
            streakBonus: 0,
            questionScore: 0,
            timedOut: true,
            idempotencyKey: timeoutAnswerIdemKey(locked.id, p.id),
            submittedAt: new Date(),
          }),
        );
        p.correctStreak = 0;
        p.answerCount += 1;
        p.totalAnswerMs += locked.timeLimitMs;
        await manager.getRepository(BattleParticipant).save(p);
      }
      locked.revealedAt = new Date();
      await manager.getRepository(BattleQuestion).save(locked);
      const b = await manager.getRepository(Battle).findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (b) await this.advanceAfterReveal(manager, b);
    });
  }

  /** Auto-advance ~6s after reveal so matches do not stall on Continue. */
  private async maybeAutoContinueAfterReveal(battleId: string) {
    const battle = await this.battlesRepo.findOneBy({ id: battleId });
    if (
      !battle ||
      ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
        battle.status,
      )
    ) {
      return;
    }
    const q = await this.questionsRepo.findOne({
      where: { battleId, orderIndex: battle.currentRound },
    });
    if (!q?.revealedAt) return;
    if (Date.now() - q.revealedAt.getTime() < 6_000) return;

    await this.dataSource.transaction(async (manager) => {
      const lockedBattle = await manager.getRepository(Battle).findOne({
        where: { id: battleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedBattle) return;
      if (
        ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
          lockedBattle.status,
        )
      ) {
        return;
      }
      const lockedQ = await manager.getRepository(BattleQuestion).findOne({
        where: {
          battleId,
          orderIndex: lockedBattle.currentRound,
        },
      });
      if (!lockedQ?.revealedAt) return;
      if (Date.now() - lockedQ.revealedAt.getTime() < 6_000) return;

      if (lockedBattle.status === BattleStatus.InProgress) {
        const normalQs = await manager.getRepository(BattleQuestion).find({
          where: { battleId, isSuddenDeath: false },
          order: { orderIndex: 'ASC' },
        });
        const next = normalQs.find((row) => !row.revealedAt && !row.openedAt);
        if (next) {
          lockedBattle.currentRound = next.orderIndex;
          await manager.getRepository(Battle).save(lockedBattle);
          await this.openQuestion(manager, lockedBattle, next.orderIndex);
          return;
        }
      }
      await this.advanceAfterReveal(manager, lockedBattle);
    });
  }

  private async serializeBattle(
    userId: string,
    battleId: string,
    manager?: DataSource['manager'],
  ) {
    const battleRepo = manager
      ? manager.getRepository(Battle)
      : this.battlesRepo;
    const partRepo = manager
      ? manager.getRepository(BattleParticipant)
      : this.participantsRepo;
    const qRepo = manager
      ? manager.getRepository(BattleQuestion)
      : this.questionsRepo;
    const aRepo = manager
      ? manager.getRepository(BattleAnswer)
      : this.answersRepo;

    const battle = await battleRepo.findOneBy({ id: battleId });
    if (!battle) {
      throw new AppException(
        AuthErrorCode.BATTLE_NOT_FOUND,
        'Battle not found',
        HttpStatus.NOT_FOUND,
      );
    }
    this.assertParticipant(battle, userId);

    const participants = await partRepo.find({ where: { battleId } });
    const opponentId =
      battle.challengerId === userId ? battle.opponentId : battle.challengerId;
    const opponentProfile = await this.profilesRepo.findOne({
      where: { userId: opponentId },
    });

    let currentQuestion: BattleQuestion | null = null;
    if (battle.currentRound > 0) {
      currentQuestion =
        (await qRepo.findOne({
          where: { battleId, orderIndex: battle.currentRound },
        })) ?? null;
    }

    const you = participants.find((p) => p.userId === userId);
    const them = participants.find((p) => p.userId !== userId);

    let currentAnswers: BattleAnswer[] = [];
    let youAnswered = false;
    let opponentAnswered = false;

    if (currentQuestion) {
      const allForQuestion = await aRepo.find({
        where: { battleQuestionId: currentQuestion.id },
      });
      youAnswered = Boolean(
        you && allForQuestion.some((a) => a.participantId === you.id),
      );
      opponentAnswered = Boolean(
        them && allForQuestion.some((a) => a.participantId === them.id),
      );

      if (currentQuestion.revealedAt) {
        currentAnswers = allForQuestion;
      }
    }

    return toBattleDto(battle, userId, {
      participants,
      currentQuestion,
      currentAnswers: currentQuestion?.revealedAt ? currentAnswers : undefined,
      youAnswered,
      opponentAnswered,
      opponentProfile,
    });
  }

  private async requireEligibleUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) {
      throw new AppException(
        AuthErrorCode.BATTLE_OPPONENT_NOT_ALLOWED,
        'User not available for battle',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!user.emailVerifiedAt) {
      throw new AppException(
        AuthErrorCode.EMAIL_NOT_VERIFIED,
        'Email not verified',
        HttpStatus.FORBIDDEN,
      );
    }
    return user;
  }

  private async assertNoConflictingBattle(userId: string) {
    const open = await this.battlesRepo.findOne({
      where: [
        { challengerId: userId, status: In(ACTIVE_STATUSES) },
        { opponentId: userId, status: In(ACTIVE_STATUSES) },
      ],
    });
    if (open) {
      throw new AppException(
        AuthErrorCode.BATTLE_ALREADY_PENDING,
        'Already in an active battle',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async rankLevelFor(userId: string): Promise<number> {
    const state = await this.leagueStateRepo.findOne({ where: { userId } });
    return state?.rankLevel ?? 1;
  }

  private async requireParticipantBattle(userId: string, battleId: string) {
    const battle = await this.battlesRepo.findOneBy({ id: battleId });
    if (!battle) {
      throw new AppException(
        AuthErrorCode.BATTLE_NOT_FOUND,
        'Battle not found',
        HttpStatus.NOT_FOUND,
      );
    }
    this.assertParticipant(battle, userId);
    return battle;
  }

  private assertParticipant(battle: Battle, userId: string) {
    if (battle.challengerId !== userId && battle.opponentId !== userId) {
      throw new AppException(
        AuthErrorCode.BATTLE_NOT_PARTICIPANT,
        'Not a participant',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async expireStaleInvites() {
    await this.battlesRepo
      .createQueryBuilder()
      .update(Battle)
      .set({ status: BattleStatus.Expired })
      .where('status = :status', { status: BattleStatus.Invited })
      .andWhere('invite_expires_at < NOW()')
      .execute();
  }

  private async runMaintenance() {
    await this.expireStaleInvites();
    await this.notifyExpiringInvites();
    await this.expireAsyncPlays();
  }

  private async notifyExpiringInvites() {
    const open = await this.battlesRepo.find({
      where: { status: BattleStatus.Invited },
      take: 50,
    });
    const now = Date.now();
    for (const b of open) {
      if (!b.inviteExpiresAt) continue;
      const expires = b.inviteExpiresAt.getTime();
      const created = b.createdAt.getTime();
      const ttl = Math.max(1, expires - created);
      const remaining = expires - now;
      if (remaining <= 0) continue;
      if (remaining / ttl > BATTLE_INVITE_EXPIRING_REMAINING_RATIO) continue;

      await this.notifications.create({
        userId: b.opponentId,
        type: NotificationType.BattleInviteExpiring,
        title: 'Battle invite expiring',
        body: 'Your challenge is about to expire — accept soon.',
        actionUrl: `/battle/invite/${b.id}`,
        payload: { battleId: b.id },
        dedupeKey: `battle_invite_expiring:${b.id}`,
        channels: [NotificationChannel.InApp, NotificationChannel.Push],
      });
    }
  }

  private async expireAsyncPlays() {
    const stale = await this.battlesRepo.find({
      where: {
        mode: BattleMode.Async,
        status: In([
          BattleStatus.Ready,
          BattleStatus.InProgress,
          BattleStatus.SuddenDeath,
        ]),
      },
      take: 30,
    });
    const now = new Date();
    for (const b of stale) {
      if (!b.playExpiresAt || b.playExpiresAt > now) continue;
      await this.dataSource.transaction(async (manager) => {
        const locked = await manager.getRepository(Battle).findOne({
          where: { id: b.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !locked ||
          !locked.playExpiresAt ||
          locked.playExpiresAt > new Date()
        ) {
          return;
        }
        if (
          ![
            BattleStatus.Ready,
            BattleStatus.InProgress,
            BattleStatus.SuddenDeath,
          ].includes(locked.status)
        ) {
          return;
        }
        await this.refundEscrows(manager, locked);
        locked.status = BattleStatus.Refunded;
        locked.resultReason = BattleResultReason.Void;
        locked.endedAt = new Date();
        await manager.getRepository(Battle).save(locked);
        await this.appendEvent(
          manager,
          locked.id,
          BattleEventType.Result,
          null,
          { reason: 'async_play_expired' },
        );
      });
    }
  }

  private async enforceDisconnectRules(battleId: string) {
    const battle = await this.battlesRepo.findOneBy({ id: battleId });
    if (
      !battle ||
      battle.mode !== BattleMode.Live ||
      ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
        battle.status,
      )
    ) {
      return;
    }

    const parts = await this.participantsRepo.find({ where: { battleId } });
    if (parts.length < 2) return;

    const now = Date.now();
    const offline: BattleParticipant[] = [];
    for (const p of parts) {
      const last = p.lastHeartbeatAt?.getTime() ?? battle.startedAt?.getTime();
      if (!last) continue;
      const absent = now - last;
      if (absent > BATTLE_DISCONNECT_GRACE_MS) {
        if (p.connectionState !== 'offline') {
          p.connectionState = 'offline';
          p.disconnectWarnings += 1;
          await this.participantsRepo.save(p);
          await this.appendEvent(
            this.dataSource.manager,
            battleId,
            BattleEventType.Disconnect,
            p.userId,
            { warnings: p.disconnectWarnings, absentMs: absent },
          );
        }
      }
      if (absent > BATTLE_DISCONNECT_FORFEIT_MS || p.disconnectWarnings >= 2) {
        offline.push(p);
      }
    }

    if (offline.length >= 2) {
      await this.dataSource.transaction(async (manager) => {
        const locked = await manager.getRepository(Battle).findOne({
          where: { id: battleId },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !locked ||
          ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
            locked.status,
          )
        ) {
          return;
        }
        await this.refundEscrows(manager, locked);
        locked.status = BattleStatus.Voided;
        locked.resultReason = BattleResultReason.Void;
        locked.endedAt = new Date();
        await manager.getRepository(Battle).save(locked);
        await this.appendEvent(
          manager,
          locked.id,
          BattleEventType.Result,
          null,
          { reason: 'both_disconnected' },
        );
      });
      return;
    }

    if (offline.length === 1) {
      const loser = offline[0];
      const winnerId =
        loser.userId === battle.challengerId
          ? battle.opponentId
          : battle.challengerId;
      await this.dataSource.transaction(async (manager) => {
        const locked = await manager.getRepository(Battle).findOne({
          where: { id: battleId },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !locked ||
          ![BattleStatus.InProgress, BattleStatus.SuddenDeath].includes(
            locked.status,
          )
        ) {
          return;
        }
        const part = await manager.getRepository(BattleParticipant).findOne({
          where: { battleId, userId: loser.userId },
        });
        if (part) {
          part.forfeited = true;
          await manager.getRepository(BattleParticipant).save(part);
        }
        await this.settleWinner(
          manager,
          locked,
          winnerId,
          BattleResultReason.Forfeit,
        );
      });
    }
  }

  private async assertRiskClear(userId: string) {
    const held = await this.battlesRepo.findOne({
      where: [
        {
          challengerId: userId,
          riskStatus: 'hold',
          status: In(ACTIVE_STATUSES),
        },
        { opponentId: userId, riskStatus: 'hold', status: In(ACTIVE_STATUSES) },
      ],
    });
    if (held) {
      throw new AppException(
        AuthErrorCode.BATTLE_RISK_HOLD,
        'Battle temporarily held for review',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async assertWalletCoins(userId: string, amount: number) {
    const wallet = await this.dataSource.transaction(async (manager) =>
      this.ledger.ensureWallet(manager, userId),
    );
    if (wallet.coins < amount) {
      throw new AppException(
        AuthErrorCode.BATTLE_INSUFFICIENT_COINS,
        'Insufficient coins',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async ledgerDebitCoins(
    manager: DataSource['manager'],
    userId: string,
    amount: number,
    battleId: string,
    suffix: string,
    settlementId: string,
  ): Promise<string> {
    const wallet = await this.ledger.ensureWallet(manager, userId, true);
    if (wallet.coins < amount) {
      throw new AppException(
        AuthErrorCode.BATTLE_INSUFFICIENT_COINS,
        'Insufficient coins',
        HttpStatus.BAD_REQUEST,
      );
    }
    const grant = await this.ledger.grantReward(manager, {
      userId,
      reasonType: RewardReasonType.Battle,
      reasonId: battleId,
      idempotencyKey: `battle:${battleId}:${suffix}:debit`,
      transactionGroupId: settlementId,
      lines: [
        {
          currency: RewardCurrency.Coins,
          amount: -amount,
          idempotencySuffix: 'coins',
        },
      ],
      metadata: { kind: 'escrow_debit', battleId },
    });
    return grant.entryIds[RewardCurrency.Coins] ?? randomUUID();
  }

  private async ledgerCreditCoins(
    manager: DataSource['manager'],
    userId: string,
    amount: number,
    battleId: string,
    suffix: string,
    settlementId: string,
  ): Promise<string> {
    const grant = await this.ledger.grantReward(manager, {
      userId,
      reasonType: RewardReasonType.Battle,
      reasonId: battleId,
      idempotencyKey: `battle:${battleId}:${suffix}:credit`,
      transactionGroupId: settlementId,
      lines: [
        {
          currency: RewardCurrency.Coins,
          amount,
          idempotencySuffix: 'coins',
        },
      ],
      metadata: { kind: 'settlement_credit', battleId },
    });
    return grant.entryIds[RewardCurrency.Coins] ?? randomUUID();
  }

  private async loadExposureHistories(userId: string, opponentId: string) {
    const recent = await this.questionsRepo
      .createQueryBuilder('q')
      .innerJoin(BattleParticipant, 'p', 'p.battle_id = q.battle_id')
      .where('p.user_id IN (:...ids)', { ids: [userId, opponentId] })
      .orderBy('q.created_at', 'DESC')
      .take(200)
      .getMany();

    const user: string[] = [];
    const opponent: string[] = [];
    // Approximate: all recent version ids for either player as shared exposure.
    for (const q of recent) {
      user.push(q.questionVersionId);
      opponent.push(q.questionVersionId);
    }
    return { user, opponent };
  }

  private async countPairBattlesToday(
    manager: DataSource['manager'],
    a: string,
    b: string,
  ): Promise<number> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    return manager.getRepository(Battle).count({
      where: [
        {
          challengerId: a,
          opponentId: b,
          status: In([
            BattleStatus.Completed,
            BattleStatus.Forfeited,
            BattleStatus.Refunded,
          ]),
          endedAt: MoreThanOrEqual(since),
        },
        {
          challengerId: b,
          opponentId: a,
          status: In([
            BattleStatus.Completed,
            BattleStatus.Forfeited,
            BattleStatus.Refunded,
          ]),
          endedAt: MoreThanOrEqual(since),
        },
      ],
    });
  }

  private async participationCoinsAllowed(
    manager: DataSource['manager'],
    userId: string,
  ): Promise<number> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const awarded = await manager.getRepository(BattleResult).count({
      where: {
        userId,
        createdAt: MoreThanOrEqual(since),
      },
    });
    // Current result not saved yet — awarded is prior completions today.
    if (awarded >= BATTLE_PARTICIPATION_COINS_DAILY_CAP) return 0;
    return BATTLE_PARTICIPATION_COINS;
  }

  private async battleLeagueXpToday(
    manager: DataSource['manager'],
    userId: string,
  ): Promise<number> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const rows = await manager.getRepository(BattleResult).find({
      where: { userId, createdAt: MoreThanOrEqual(since) },
    });
    return rows.reduce((sum, r) => sum + Math.min(r.xpAwarded, 100), 0);
  }

  private async appendEvent(
    manager: DataSource['manager'],
    battleId: string,
    type: BattleEventType,
    actorUserId: string | null,
    payload: Record<string, unknown>,
  ) {
    this.eventSeq += 1;
    await manager.getRepository(BattleEvent).save(
      manager.getRepository(BattleEvent).create({
        battleId,
        sequence: String(Date.now() * 1000 + (this.eventSeq % 1000)),
        type,
        actorUserId,
        payload,
      }),
    );
  }
}
