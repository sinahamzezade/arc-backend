import { Battle } from './entities/battle.entity';
import { BattleAnswer } from './entities/battle-answer.entity';
import { BattleParticipant } from './entities/battle-participant.entity';
import { BattleQuestion } from './entities/battle-question.entity';
import { BattleResult } from './entities/battle-result.entity';

function stemFromPrompt(prompt: Record<string, unknown>): string {
  if (typeof prompt.stem === 'string') return prompt.stem;
  if (typeof prompt.text === 'string') return prompt.text;
  if (typeof prompt.body === 'string') return prompt.body;
  return 'Question';
}

export function toPublicQuestion(
  q: BattleQuestion,
  opts?: {
    includeReveal?: boolean;
    answers?: BattleAnswer[];
    viewerParticipantId?: string;
  },
) {
  const base = {
    id: q.id,
    orderIndex: q.orderIndex,
    round: q.round,
    isSuddenDeath: q.isSuddenDeath,
    questionVersionId: q.questionVersionId,
    difficulty: q.difficulty,
    timeLimitMs: q.timeLimitMs,
    openedAt: q.openedAt?.toISOString() ?? null,
    revealedAt: q.revealedAt?.toISOString() ?? null,
    prompt: q.prompt,
    stem: stemFromPrompt(q.prompt),
    options: q.options,
  };

  if (!opts?.includeReveal || !q.revealedAt) {
    return base;
  }

  return {
    ...base,
    correctOptionIds: q.correctOptionIds,
    explanation: q.explanation,
    answers: (opts.answers ?? []).map((a) => ({
      participantId: a.participantId,
      selectedOptionId: a.selectedOptionId,
      isCorrect: a.isCorrect,
      questionScore: a.questionScore,
      responseMs: a.responseMs,
      timedOut: a.timedOut,
      isYou: opts.viewerParticipantId
        ? a.participantId === opts.viewerParticipantId
        : false,
    })),
  };
}

export function toBattleDto(
  battle: Battle,
  viewerId: string,
  extras?: {
    participants?: BattleParticipant[];
    currentQuestion?: BattleQuestion | null;
    currentAnswers?: BattleAnswer[];
    youAnswered?: boolean;
    opponentAnswered?: boolean;
    opponentProfile?: {
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
    } | null;
  },
) {
  const participants = extras?.participants ?? battle.participants ?? [];
  const you = participants.find((p) => p.userId === viewerId);
  const them = participants.find((p) => p.userId !== viewerId);
  const yourScore =
    battle.challengerId === viewerId
      ? battle.challengerScore
      : battle.opponentScore;
  const theirScore =
    battle.challengerId === viewerId
      ? battle.opponentScore
      : battle.challengerScore;

  const q = extras?.currentQuestion;
  const revealed = Boolean(q?.revealedAt);

  return {
    id: battle.id,
    status: battle.status,
    mode: battle.mode,
    subject: battle.subject,
    topic: battle.topic,
    difficulty: battle.difficulty,
    questionCount: battle.questionCount,
    secondsPerQuestion: battle.secondsPerQuestion,
    stakePerPlayer: battle.stakePerPlayer,
    pot: battle.stakePerPlayer * 2,
    currentRound: battle.currentRound,
    inviteExpiresAt: battle.inviteExpiresAt?.toISOString() ?? null,
    startedAt: battle.startedAt?.toISOString() ?? null,
    endedAt: battle.endedAt?.toISOString() ?? null,
    playExpiresAt: battle.playExpiresAt?.toISOString() ?? null,
    winnerId: battle.winnerId,
    resultReason: battle.resultReason,
    role: you?.role ?? null,
    yourScore,
    theirScore,
    youReady: you?.isReady ?? false,
    opponentReady: them?.isReady ?? false,
    youAnswered: extras?.youAnswered ?? false,
    opponentAnswered: extras?.opponentAnswered ?? false,
    youOnline: you?.connectionState === 'online',
    opponentOnline: them?.connectionState === 'online',
    suddenDeathCount: battle.suddenDeathCount,
    isSuddenDeath: battle.status === 'sudden_death',
    opponent: {
      userId: them?.userId ?? (battle.challengerId === viewerId
        ? battle.opponentId
        : battle.challengerId),
      displayName: extras?.opponentProfile?.displayName ?? null,
      username: extras?.opponentProfile?.username ?? null,
      avatarUrl: extras?.opponentProfile?.avatarUrl ?? null,
    },
    currentQuestion: q
      ? toPublicQuestion(q, {
          includeReveal: revealed,
          answers: extras?.currentAnswers,
          viewerParticipantId: you?.id,
        })
      : null,
    serverTimestamp: new Date().toISOString(),
  };
}

export function toHistoryItemDto(row: BattleResult) {
  return {
    id: row.battleId,
    opponentId: row.opponentId,
    opponentName: row.opponentDisplayName,
    subject: row.subject,
    topic: row.topic,
    result: row.result,
    yourScore: row.yourScore,
    theirScore: row.theirScore,
    stake: row.stakePerPlayer,
    coinsDelta: row.coinsDelta,
    accuracy: row.accuracy,
    avgAnswerMs: row.avgAnswerMs,
    xpAwarded: row.xpAwarded,
    createdAt: row.createdAt.toISOString(),
  };
}
