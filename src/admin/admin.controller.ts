import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import {
  BadgeCategory,
  BadgeCriteriaType,
  BadgeDefinitionStatus,
  BadgeRarity,
  type BadgeCriteriaJson,
  type BadgeRewardJson,
} from '../badges/badge.constants';
import {
  QuestCadence,
  QuestCategory,
  QuestConditionType,
  QuestDefinitionStatus,
  type QuestConditionJson,
  type QuestRewardJson,
} from '../quests/quest.constants';
import { RewardCurrency } from '../gamification/entities/reward-ledger-entry.entity';
import { StoreItemType } from '../gamification/entities/store-item.entity';
import { WheelCampaignStatus } from '../lucky-wheel/entities/wheel.enums';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminBadgeIconService } from './admin-badge-icon.service';
import { AdminRankIconService } from './admin-rank-icon.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminQuestionnaireService } from './admin-questionnaire.service';
import { AdminRolesService } from './admin-roles.service';
import { AdminGoalsService } from './admin-goals.service';
import { AdminRoadmapEngineService } from './admin-roadmap-engine.service';
import { AdminUserResetService } from './admin-user-reset.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminSessionGuard } from './guards/admin-session.guard';
import type { AdminRequest } from './types/admin-request';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import { AuthService } from '../auth/auth.service';
import { AppException } from '../common/errors/app.exception';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import { SystemFlagKey } from '../system-flags/system-flag.keys';
import { RewardLedgerService } from '../gamification/reward-ledger.service';
import { LlmUsageService } from '../common/llm/llm-usage.service';
import { LlmService } from '../common/llm/llm.service';
import { llmAdminCatalog } from '../common/llm/llm.providers';
import { UnitsCatalogService } from '../content-pool/units-catalog.service';
import { isUnitsJsonDocument } from '../content-pool/units-json.types';
import { UnitsGraphError } from '../content-pool/units-graph.util';
import { EXAMPLE_UNITS_DOCUMENT } from '../content-pool/units-example';
import { GoalStatus } from '../goals/entities/goal.entity';

function checked(v: unknown): boolean {
  return v === '1' || v === 'on' || v === true || v === 'true';
}

/**
 * Express already URL-decodes query values. Calling decodeURIComponent again
 * throws URIError when the value contains a literal `%` (e.g. "50% done").
 */
function csvList(v: unknown): string[] {
  return String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function flashQuery(v: string | undefined | null): string | null {
  if (v == null || v === '') return null;
  return v;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optNum(v: unknown): number | null {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function optDate(v: unknown): Date | null {
  if (v === '' || v === undefined || v === null) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function selectOpts(
  values: string[],
  current: string,
): { value: string; label: string; selected: boolean }[] {
  return values.map((value) => ({
    value,
    label: value,
    selected: value === current,
  }));
}

const QUESTIONNAIRE_UI_KINDS = [
  'options',
  'schedule',
  'track-select',
  'skill-evidence',
  'capacity',
  'outcome',
  'context',
  'confidence-barriers',
];

function fmtDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function parseJsonObject<T extends Record<string, unknown>>(
  raw: string,
  label: string,
): T {
  const text = String(raw ?? '').trim();
  if (!text) return {} as T;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException(`${label} must be a JSON object`);
    }
    return parsed as T;
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException(`${label} is invalid JSON`);
  }
}

function adminErrMessage(e: unknown, fallback: string): string {
  if (e instanceof BadRequestException) {
    const body = e.getResponse() as { message?: string | string[] };
    const raw = body.message ?? e.message;
    return Array.isArray(raw) ? raw.join(', ') : String(raw);
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

function toAdminUserView(u: User) {
  const p = u.profile;
  return {
    id: u.id,
    email: u.email,
    authProvider: u.authProvider,
    isActive: u.isActive,
    isAdmin: u.isAdmin,
    hasPassword: Boolean(u.passwordHash),
    emailVerifiedAt: fmtDate(u.emailVerifiedAt),
    passwordLastChangedAt: fmtDate(u.passwordLastChangedAt),
    createdAt: fmtDate(u.createdAt),
    updatedAt: fmtDate(u.updatedAt),
    lastLoginAt: fmtDate(u.lastLoginAt),
    hasProfile: Boolean(p),
    displayName: p?.displayName ?? null,
    username: p?.username ?? null,
    language: p?.language ?? null,
    timezone: p?.timezone ?? null,
    currentRank: p?.currentRank ?? null,
    totalXp: p?.totalXp ?? 0,
    coins: p?.coins ?? 0,
    gems: p?.gems ?? 0,
    weeklyStreak: p?.weeklyStreak ?? 0,
    questionnaireStatus: p?.questionnaireStatus ?? null,
    questionnaireCompletedAt: fmtDate(p?.questionnaireCompletedAt),
    onboardingCompletedAt: fmtDate(p?.onboardingCompletedAt),
  };
}

type RoadmapTree = NonNullable<
  Awaited<ReturnType<RoadmapsService['getCurrent']>>['roadmap']
>;
type RoadmapJob = Awaited<ReturnType<RoadmapsService['getCurrent']>>['job'];

function lessonStatusFlags(status: string) {
  return {
    status,
    isCompleted: status === 'completed',
    isAvailable: status === 'available',
    isLocked: status === 'locked',
  };
}

function toAdminRoadmapView(tree: RoadmapTree) {
  let lessonTotal = 0;
  let lessonCompleted = 0;
  let lessonAvailable = 0;

  const phases = tree.phases.map((phase) => {
    const milestones = phase.milestones.map((milestone) => {
      const lessons = milestone.lessons.map((lesson) => {
        lessonTotal += 1;
        if (lesson.status === 'completed') lessonCompleted += 1;
        if (lesson.status === 'available') lessonAvailable += 1;
        return {
          id: lesson.id,
          title: lesson.title,
          missionName: lesson.missionName,
          lessonType: lesson.lessonType,
          estimatedMinutes: lesson.estimatedMinutes,
          xpReward: lesson.xpReward,
          orderIndex: lesson.orderIndex,
          ...lessonStatusFlags(lesson.status),
        };
      });
      return {
        id: milestone.id,
        title: milestone.title,
        orderIndex: milestone.orderIndex,
        type: milestone.type,
        lessonCount: lessons.length,
        lessons,
      };
    });
    return {
      id: phase.id,
      title: phase.title,
      orderIndex: phase.orderIndex,
      locked: phase.locked,
      techStackSlug: phase.techStackSlug,
      isCurrent: phase.id === tree.currentPhaseId,
      milestoneCount: milestones.length,
      milestones,
    };
  });

  return {
    id: tree.id,
    title: tree.title,
    primaryRoleSlug: tree.primaryRoleSlug,
    timelineWeeks: tree.timelineWeeks,
    progressPercent: tree.progressPercent,
    status: tree.status,
    isReady: tree.status === 'ready',
    isGenerating: tree.status === 'generating',
    isFailed: tree.status === 'failed',
    isArchived: tree.status === 'archived',
    lessonTotal,
    lessonCompleted,
    lessonAvailable,
    phaseCount: phases.length,
    hasPhases: phases.length > 0,
    phases,
  };
}

function toAdminJobView(job: RoadmapJob) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    roadmapId: job.roadmapId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    isQueued: job.status === 'queued',
    isProcessing: job.status === 'processing',
    isReady: job.status === 'ready',
    isFailed: job.status === 'failed',
  };
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly usersService: UsersService,
    private readonly analytics: AdminAnalyticsService,
    private readonly catalog: AdminCatalogService,
    private readonly roadmapEngineAdmin: AdminRoadmapEngineService,
    private readonly goalsAdmin: AdminGoalsService,
    private readonly badgeIcons: AdminBadgeIconService,
    private readonly rankIcons: AdminRankIconService,
    private readonly rolesAdmin: AdminRolesService,
    private readonly questionnaireAdmin: AdminQuestionnaireService,
    private readonly userReset: AdminUserResetService,
    private readonly roadmapsService: RoadmapsService,
    private readonly authService: AuthService,
    private readonly systemFlags: SystemFlagsService,
    private readonly rewardLedger: RewardLedgerService,
    private readonly llmUsage: LlmUsageService,
    private readonly llm: LlmService,
    private readonly unitsCatalog: UnitsCatalogService,
  ) {}

  @Get()
  @UseGuards(AdminSessionGuard)
  @Render('dashboard')
  async dashboard(@Req() req: AdminRequest) {
    return {
      title: 'Dashboard',
      email: req.session.adminEmail ?? '',
      navDashboard: true,
    };
  }

  @Get('api/analytics')
  @UseGuards(AdminSessionGuard)
  async analyticsApi() {
    return this.analytics.getDashboardAnalytics(30);
  }

  @Get('users')
  @UseGuards(AdminSessionGuard)
  @Render('users')
  async users(@Req() req: AdminRequest) {
    const rows = await this.usersService.listForAdmin();
    const users = rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? null,
      authProvider: u.authProvider,
      isActive: u.isActive,
      isAdmin: u.isAdmin,
      createdAt: fmtDate(u.createdAt),
      lastLoginAt: fmtDate(u.lastLoginAt),
    }));

    return {
      title: 'Users',
      email: req.session.adminEmail ?? '',
      navUsers: true,
      users,
      hasUsers: users.length > 0,
      userCount: users.length,
      userCountSingular: users.length === 1,
    };
  }

  @Get('users/:id')
  @UseGuards(AdminSessionGuard)
  async userDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const row = await this.usersService.findById(id);
    if (!row) {
      return res.redirect('/admin/users');
    }

    const flashMap: Record<string, string> = {
      suspended: 'User suspended.',
      unsuspended: 'User unsuspended.',
      reset:
        'Questionnaire + roadmap reset. Learner profiles cleared; sessions revoked — user must sign in again.',
      password: 'Password updated. Active sessions revoked.',
      flags: 'User feature flags saved.',
      wallet: 'XP / coins / gems updated.',
    };
    const errMap: Record<string, string> = {
      self: 'Cannot change your own account from here.',
      missing: 'User not found.',
    };

    const { job, roadmap } = await this.roadmapsService.getCurrent(row.id);
    const roadmapView = roadmap ? toAdminRoadmapView(roadmap) : null;
    const aiUsage = await this.llmUsage.reportForUser(row.id);
    const userFlags = await this.systemFlags.listForUser(row.id);
    const flagRows = userFlags.map((f) => ({
      ...f,
      isBoolean: f.valueType === 'boolean',
      inheritSelected: f.overrideValue === null,
      options: (f.options ?? []).map((value) => ({
        value,
        label: value,
        selected: f.overrideValue === value,
      })),
      boolOptions: [
        {
          value: '__inherit__',
          label: `Inherit (${f.systemValue === 'true' ? 'on' : 'off'})`,
          selected: f.overrideValue === null,
        },
        {
          value: 'true',
          label: 'Force on',
          selected: f.overrideValue === 'true',
        },
        {
          value: 'false',
          label: 'Force off',
          selected: f.overrideValue === 'false',
        },
      ],
      stringOptions: [
        {
          value: '__inherit__',
          label: `Inherit (${f.systemValue})`,
          selected: f.overrideValue === null,
        },
        ...(f.options ?? []).map((value) => ({
          value,
          label: value,
          selected: f.overrideValue === value,
        })),
      ],
    }));

    return res.render('user-detail', {
      title: row.email,
      email: req.session.adminEmail ?? '',
      navUsers: true,
      user: toAdminUserView(row),
      isSelf: req.session.adminUserId === row.id,
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: err ? (errMap[err] ?? flashQuery(err) ?? err) : null,
      hasRoadmap: Boolean(roadmapView),
      roadmap: roadmapView,
      job: toAdminJobView(job),
      userFlags: flagRows,
      aiUsage,
    });
  }

  @Post('users/:id/feature-flags')
  @UseGuards(AdminSessionGuard)
  async saveUserFeatureFlags(
    @Param('id') id: string,
    @Body() body: Record<string, string | string[]>,
    @Res() res: Response,
  ) {
    const row = await this.usersService.findById(id);
    if (!row) {
      return res.redirect('/admin/users');
    }
    try {
      const updates: Record<string, string> = {};
      for (const [key, raw] of Object.entries(body)) {
        if (key === '_csrf') continue;
        updates[key] = Array.isArray(raw)
          ? String(raw.at(-1) ?? '')
          : String(raw);
      }
      await this.systemFlags.setUserOverrides(id, updates);
      return res.redirect(`/admin/users/${id}?ok=flags`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(`/admin/users/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('users/:id/reset-learning')
  @UseGuards(AdminSessionGuard)
  async resetUserLearning(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.userReset.resetQuestionnaireAndRoadmap(id);
      return res.redirect(`/admin/users/${id}?ok=reset`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Reset failed';
      return res.redirect(`/admin/users/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('users/:id/wallet')
  @UseGuards(AdminSessionGuard)
  async setUserWallet(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    const row = await this.usersService.findById(id);
    if (!row) {
      return res.redirect('/admin/users');
    }
    const lifetimeXp = Number(body.totalXp);
    const coins = Number(body.coins);
    const gems = Number(body.gems);
    if (
      !Number.isFinite(lifetimeXp) ||
      !Number.isFinite(coins) ||
      !Number.isFinite(gems) ||
      lifetimeXp < 0 ||
      coins < 0 ||
      gems < 0
    ) {
      return res.redirect(
        `/admin/users/${id}?err=${encodeURIComponent(
          'XP, coins, and gems must be non-negative numbers.',
        )}`,
      );
    }
    try {
      await this.rewardLedger.adminSetBalances(
        id,
        { lifetimeXp, coins, gems },
        { adminUserId: req.session.adminUserId },
      );
      return res.redirect(`/admin/users/${id}?ok=wallet`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Wallet update failed';
      return res.redirect(`/admin/users/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('users/:id/change-password')
  @UseGuards(AdminSessionGuard)
  async changeUserPassword(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const password = String(body.password ?? '');
    const confirmPassword = String(body.confirmPassword ?? '');
    try {
      await this.authService.adminSetPassword(id, password, confirmPassword);
      return res.redirect(`/admin/users/${id}?ok=password`);
    } catch (e) {
      let msg = 'Password update failed';
      if (e instanceof AppException) {
        const body = e.getResponse() as { message?: string | string[] };
        const raw = body.message ?? e.message;
        msg = Array.isArray(raw) ? raw.join(', ') : String(raw);
      } else if (e instanceof Error) {
        msg = e.message;
      }
      return res.redirect(`/admin/users/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('users/:id/suspend')
  @UseGuards(AdminSessionGuard)
  async suspendUser(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    if (req.session.adminUserId === id) {
      return res.redirect(`/admin/users/${id}?err=self`);
    }
    const updated = await this.usersService.setActive(id, false);
    if (!updated) {
      return res.redirect('/admin/users?err=missing');
    }
    return res.redirect(`/admin/users/${id}?ok=suspended`);
  }

  @Post('users/:id/unsuspend')
  @UseGuards(AdminSessionGuard)
  async unsuspendUser(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    if (req.session.adminUserId === id) {
      return res.redirect(`/admin/users/${id}?err=self`);
    }
    const updated = await this.usersService.setActive(id, true);
    if (!updated) {
      return res.redirect('/admin/users?err=missing');
    }
    return res.redirect(`/admin/users/${id}?ok=unsuspended`);
  }

  @Post('users/:id/delete')
  @UseGuards(AdminSessionGuard)
  async deleteUser(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    if (req.session.adminUserId === id) {
      return res.redirect(`/admin/users/${id}?err=self`);
    }
    const ok = await this.usersService.softDelete(id);
    if (!ok) {
      return res.redirect('/admin/users');
    }
    return res.redirect('/admin/users');
  }

  @Get('ranks')
  @UseGuards(AdminSessionGuard)
  @Render('ranks')
  async ranks(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = (await this.catalog.listRanks()).map((r) => ({
      ...r,
      iconThumbUrl: AdminRankIconService.isUploadPath(r.iconAssetKey)
        ? r.iconAssetKey
        : null,
    }));
    const flashMap: Record<string, string> = {
      created: 'Rank created.',
      deleted: 'Rank deleted.',
    };
    return {
      title: 'Ranks',
      email: req.session.adminEmail ?? '',
      navRanks: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('ranks')
  @UseGuards(AdminSessionGuard)
  async rankCreate(@Body() body: Record<string, string>, @Res() res: Response) {
    try {
      const level = num(body.level, 0);
      const row = await this.catalog.createRank({
        level,
        slug: String(body.slug ?? '').trim(),
        title: String(body.title ?? '').trim(),
        xpThreshold: num(body.xpThreshold),
        minimumActiveDays: num(body.minimumActiveDays),
        displayOrder: num(body.displayOrder, level),
        isActive: checked(body.isActive ?? '1'),
        iconAssetKey: String(body.iconAssetKey ?? '').trim() || null,
      });
      return res.redirect(`/admin/ranks/${row.id}?ok=created`);
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : e instanceof Error
            ? e.message
            : 'Create failed';
      return res.redirect(
        `/admin/ranks?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
      );
    }
  }

  @Get('ranks/:id')
  @UseGuards(AdminSessionGuard)
  async rankDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const row = await this.catalog.getRank(id);
      const iconKey = row.iconAssetKey ?? '';
      const hasUpload = AdminRankIconService.isUploadPath(iconKey);
      const flashMap: Record<string, string> = {
        '1': 'Rank saved.',
        created: 'Rank created.',
        icon: 'Rank image uploaded.',
        cleared: 'Rank image cleared.',
      };
      return res.render('rank-detail', {
        title: row.title,
        email: req.session.adminEmail ?? '',
        navRanks: true,
        row: {
          ...row,
          iconAssetKey: iconKey,
        },
        hasUpload,
        iconPreviewUrl: hasUpload ? iconKey : null,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect('/admin/ranks');
    }
  }

  @Post('ranks/:id')
  @UseGuards(AdminSessionGuard)
  async rankSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.catalog.updateRank(id, {
        level: num(body.level),
        slug: String(body.slug ?? '').trim(),
        title: String(body.title ?? '').trim(),
        xpThreshold: num(body.xpThreshold),
        minimumActiveDays: num(body.minimumActiveDays),
        displayOrder: num(body.displayOrder),
        iconAssetKey: String(body.iconAssetKey ?? '').trim() || null,
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/ranks/${id}?ok=1`);
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : e instanceof Error
            ? e.message
            : 'Save failed';
      return res.redirect(
        `/admin/ranks/${id}?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
      );
    }
  }

  @Post('ranks/:id/delete')
  @UseGuards(AdminSessionGuard)
  async rankDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      const row = await this.catalog.getRank(id);
      if (AdminRankIconService.isUploadPath(row.iconAssetKey)) {
        await this.rankIcons.clearIcon(id);
      }
      await this.catalog.deleteRank(id);
      return res.redirect('/admin/ranks?ok=deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(`/admin/ranks/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('ranks/:id/icon')
  @UseGuards(AdminSessionGuard)
  @UseInterceptors(
    FileInterceptor('icon', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async rankIconUpload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() res: Response,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('Choose an image file');
      }
      await this.rankIcons.saveIcon(id, file);
      return res.redirect(`/admin/ranks/${id}?ok=icon`);
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : 'Upload failed';
      return res.redirect(
        `/admin/ranks/${id}?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
      );
    }
  }

  @Post('ranks/:id/icon/clear')
  @UseGuards(AdminSessionGuard)
  async rankIconClear(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.rankIcons.clearIcon(id);
      return res.redirect(`/admin/ranks/${id}?ok=cleared`);
    } catch {
      return res.redirect(
        `/admin/ranks/${id}?err=${encodeURIComponent('Clear failed')}`,
      );
    }
  }

  @Get('store')
  @UseGuards(AdminSessionGuard)
  @Render('store')
  async store(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = await this.catalog.listStoreItems();
    const flashMap: Record<string, string> = {
      deleted: 'Store item deleted.',
    };
    return {
      title: 'Store',
      email: req.session.adminEmail ?? '',
      navStore: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      currencies: selectOpts(
        Object.values(RewardCurrency),
        RewardCurrency.Coins,
      ),
      itemTypes: selectOpts(
        Object.values(StoreItemType),
        StoreItemType.Consumable,
      ),
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('store')
  @UseGuards(AdminSessionGuard)
  async storeCreate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const row = await this.catalog.createStoreItem({
        sku: String(body.sku ?? '').trim(),
        title: String(body.title ?? '').trim(),
        description: String(body.description ?? ''),
        price: num(body.price),
        currency: (body.currency as RewardCurrency) || RewardCurrency.Coins,
        itemType: (body.itemType as StoreItemType) || StoreItemType.Consumable,
        rarity: String(body.rarity ?? 'common').trim(),
        purchaseLimit: optNum(body.purchaseLimit),
        isActive: checked(body.isActive ?? '1'),
      });
      return res.redirect(`/admin/store/${row.id}?ok=created`);
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : e instanceof Error
            ? e.message
            : 'Create failed';
      return res.redirect(
        `/admin/store?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
      );
    }
  }

  @Get('store/:id')
  @UseGuards(AdminSessionGuard)
  async storeDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const row = await this.catalog.getStoreItem(id);
      const flashMap: Record<string, string> = {
        '1': 'Store item saved.',
        created: 'Store item created.',
      };
      return res.render('store-detail', {
        title: row.title,
        email: req.session.adminEmail ?? '',
        navStore: true,
        row: {
          ...row,
          purchaseLimit: row.purchaseLimit ?? '',
        },
        currencies: selectOpts(Object.values(RewardCurrency), row.currency),
        itemTypes: selectOpts(Object.values(StoreItemType), row.itemType),
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect('/admin/store');
    }
  }

  @Post('store/:id')
  @UseGuards(AdminSessionGuard)
  async storeSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.catalog.updateStoreItem(id, {
        sku: String(body.sku ?? '').trim(),
        title: String(body.title ?? '').trim(),
        description: String(body.description ?? ''),
        price: num(body.price),
        currency: body.currency as RewardCurrency,
        itemType: body.itemType as StoreItemType,
        rarity: String(body.rarity ?? 'common').trim(),
        purchaseLimit: optNum(body.purchaseLimit),
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/store/${id}?ok=1`);
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : e instanceof Error
            ? e.message
            : 'Save failed';
      return res.redirect(
        `/admin/store/${id}?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
      );
    }
  }

  @Post('store/:id/delete')
  @UseGuards(AdminSessionGuard)
  async storeDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.catalog.deleteStoreItem(id);
      return res.redirect('/admin/store?ok=deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(`/admin/store/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Get('badges')
  @UseGuards(AdminSessionGuard)
  @Render('badges')
  async badges(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = (await this.catalog.listBadges()).map((b) => ({
      ...b,
      isActiveStatus: b.status === BadgeDefinitionStatus.Active,
      iconThumbUrl: AdminBadgeIconService.isUploadPath(b.iconAssetKey)
        ? b.iconAssetKey
        : null,
    }));
    const flashMap: Record<string, string> = {
      deleted: 'Badge deleted.',
    };
    return {
      title: 'Badges',
      email: req.session.adminEmail ?? '',
      navBadges: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      categories: selectOpts(
        Object.values(BadgeCategory),
        BadgeCategory.Learning,
      ),
      rarities: selectOpts(Object.values(BadgeRarity), BadgeRarity.Common),
      statuses: selectOpts(
        Object.values(BadgeDefinitionStatus),
        BadgeDefinitionStatus.Active,
      ),
      criteriaTypes: selectOpts(
        Object.values(BadgeCriteriaType),
        BadgeCriteriaType.Counter,
      ),
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('badges')
  @UseGuards(AdminSessionGuard)
  async badgeCreate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const criteriaJson = parseJsonObject<BadgeCriteriaJson>(
        body.criteriaJson,
        'criteriaJson',
      );
      const rewardJson = parseJsonObject<BadgeRewardJson>(
        body.rewardJson ?? '{}',
        'rewardJson',
      );
      const row = await this.catalog.createBadge({
        code: String(body.code ?? '').trim(),
        name: String(body.name ?? '').trim(),
        description: String(body.description ?? ''),
        category: (body.category as BadgeCategory) || BadgeCategory.Learning,
        rarity: (body.rarity as BadgeRarity) || BadgeRarity.Common,
        status:
          (body.status as BadgeDefinitionStatus) ||
          BadgeDefinitionStatus.Active,
        criteriaType:
          (body.criteriaType as BadgeCriteriaType) || BadgeCriteriaType.Counter,
        criteriaJson,
        rewardJson,
        sortOrder: num(body.sortOrder),
        isHidden: checked(body.isHidden),
        iconAssetKey: String(body.iconAssetKey ?? '').trim() || null,
      });
      return res.redirect(`/admin/badges/${row.id}?ok=created`);
    } catch (e) {
      return res.redirect(
        `/admin/badges?err=${encodeURIComponent(adminErrMessage(e, 'Create failed'))}`,
      );
    }
  }

  @Get('badges/:id')
  @UseGuards(AdminSessionGuard)
  async badgeDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const row = await this.catalog.getBadge(id);
      const iconKey = row.iconAssetKey ?? '';
      const hasUpload = AdminBadgeIconService.isUploadPath(iconKey);
      const flashMap: Record<string, string> = {
        '1': 'Badge saved.',
        created: 'Badge created.',
        icon: 'Badge image uploaded.',
        cleared: 'Badge image cleared.',
      };
      return res.render('badge-detail', {
        title: row.name,
        email: req.session.adminEmail ?? '',
        navBadges: true,
        row: {
          ...row,
          iconAssetKey: iconKey,
          criteriaJsonText: JSON.stringify(row.criteriaJson ?? {}, null, 2),
          rewardJsonText: JSON.stringify(row.rewardJson ?? {}, null, 2),
        },
        iconPreviewUrl: hasUpload ? iconKey : null,
        hasUpload,
        categories: selectOpts(Object.values(BadgeCategory), row.category),
        rarities: selectOpts(Object.values(BadgeRarity), row.rarity),
        statuses: selectOpts(Object.values(BadgeDefinitionStatus), row.status),
        criteriaTypes: selectOpts(
          Object.values(BadgeCriteriaType),
          row.criteriaType,
        ),
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect('/admin/badges');
    }
  }

  @Post('badges/:id')
  @UseGuards(AdminSessionGuard)
  async badgeSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const criteriaJson = parseJsonObject<BadgeCriteriaJson>(
        body.criteriaJson,
        'criteriaJson',
      );
      const rewardJson = parseJsonObject<BadgeRewardJson>(
        body.rewardJson ?? '{}',
        'rewardJson',
      );
      await this.catalog.updateBadge(id, {
        code: String(body.code ?? '').trim(),
        name: String(body.name ?? '').trim(),
        description: String(body.description ?? ''),
        category: body.category as BadgeCategory,
        rarity: body.rarity as BadgeRarity,
        status: body.status as BadgeDefinitionStatus,
        criteriaType: body.criteriaType as BadgeCriteriaType,
        criteriaJson,
        rewardJson,
        sortOrder: num(body.sortOrder),
        iconAssetKey: String(body.iconAssetKey ?? '').trim() || null,
        isHidden: checked(body.isHidden),
      });
      return res.redirect(`/admin/badges/${id}?ok=1`);
    } catch (e) {
      return res.redirect(
        `/admin/badges/${id}?err=${encodeURIComponent(adminErrMessage(e, 'Save failed'))}`,
      );
    }
  }

  @Post('badges/:id/delete')
  @UseGuards(AdminSessionGuard)
  async badgeDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      const row = await this.catalog.getBadge(id);
      if (AdminBadgeIconService.isUploadPath(row.iconAssetKey)) {
        await this.badgeIcons.clearIcon(id);
      }
      await this.catalog.deleteBadge(id);
      return res.redirect('/admin/badges?ok=deleted');
    } catch (e) {
      return res.redirect(
        `/admin/badges/${id}?err=${encodeURIComponent(adminErrMessage(e, 'Delete failed'))}`,
      );
    }
  }

  @Post('badges/:id/icon')
  @UseGuards(AdminSessionGuard)
  @UseInterceptors(
    FileInterceptor('icon', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async badgeIconUpload(
    @Param('id') id: string,
    @UploadedFile()
    file: { buffer: Buffer; size: number; mimetype: string } | undefined,
    @Res() res: Response,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('Choose an image file');
      }
      await this.badgeIcons.saveIcon(id, file);
      return res.redirect(`/admin/badges/${id}?ok=icon`);
    } catch (e) {
      return res.redirect(
        `/admin/badges/${id}?err=${encodeURIComponent(adminErrMessage(e, 'Upload failed'))}`,
      );
    }
  }

  @Post('badges/:id/icon/clear')
  @UseGuards(AdminSessionGuard)
  async badgeIconClear(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.badgeIcons.clearIcon(id);
      return res.redirect(`/admin/badges/${id}?ok=cleared`);
    } catch {
      return res.redirect(
        `/admin/badges/${id}?err=${encodeURIComponent('Clear failed')}`,
      );
    }
  }

  @Get('quests')
  @UseGuards(AdminSessionGuard)
  @Render('quests')
  async quests(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = (await this.catalog.listQuests()).map((q) => ({
      ...q,
      isActiveStatus: q.status === QuestDefinitionStatus.Active,
    }));
    const flashMap: Record<string, string> = {
      deleted: 'Quest deleted.',
    };
    return {
      title: 'Quests',
      email: req.session.adminEmail ?? '',
      navQuests: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      cadences: selectOpts(Object.values(QuestCadence), QuestCadence.Weekly),
      categories: selectOpts(
        Object.values(QuestCategory),
        QuestCategory.League,
      ),
      statuses: selectOpts(
        Object.values(QuestDefinitionStatus),
        QuestDefinitionStatus.Active,
      ),
      conditionTypes: selectOpts(
        Object.values(QuestConditionType),
        QuestConditionType.Counter,
      ),
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('quests')
  @UseGuards(AdminSessionGuard)
  async questCreate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const conditionJson = parseJsonObject<QuestConditionJson>(
        body.conditionJson,
        'conditionJson',
      );
      const rewardJson = parseJsonObject<QuestRewardJson>(
        body.rewardJson ?? '{}',
        'rewardJson',
      );
      const row = await this.catalog.createQuest({
        code: String(body.code ?? '').trim(),
        name: String(body.name ?? '').trim(),
        description: String(body.description ?? ''),
        detail: String(body.detail ?? ''),
        cadence: (body.cadence as QuestCadence) || QuestCadence.Weekly,
        category: (body.category as QuestCategory) || QuestCategory.League,
        status:
          (body.status as QuestDefinitionStatus) ||
          QuestDefinitionStatus.Active,
        conditionType:
          (body.conditionType as QuestConditionType) ||
          QuestConditionType.Counter,
        conditionJson,
        rewardJson,
        sortOrder: num(body.sortOrder),
        isOptional: checked(body.isOptional),
        startsAt: optDate(body.startsAt),
        endsAt: optDate(body.endsAt),
      });
      return res.redirect(`/admin/quests/${row.id}?ok=created`);
    } catch (e) {
      return res.redirect(
        `/admin/quests?err=${encodeURIComponent(adminErrMessage(e, 'Create failed'))}`,
      );
    }
  }

  @Get('quests/:id')
  @UseGuards(AdminSessionGuard)
  async questDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const row = await this.catalog.getQuest(id);
      const flashMap: Record<string, string> = {
        '1': 'Quest saved.',
        created: 'Quest created.',
      };
      return res.render('quest-detail', {
        title: row.name,
        email: req.session.adminEmail ?? '',
        navQuests: true,
        row: {
          ...row,
          conditionJsonText: JSON.stringify(row.conditionJson ?? {}, null, 2),
          rewardJsonText: JSON.stringify(row.rewardJson ?? {}, null, 2),
          startsAtInput: row.startsAt
            ? row.startsAt.toISOString().slice(0, 16)
            : '',
          endsAtInput: row.endsAt ? row.endsAt.toISOString().slice(0, 16) : '',
        },
        cadences: selectOpts(Object.values(QuestCadence), row.cadence),
        categories: selectOpts(Object.values(QuestCategory), row.category),
        statuses: selectOpts(Object.values(QuestDefinitionStatus), row.status),
        conditionTypes: selectOpts(
          Object.values(QuestConditionType),
          row.conditionType,
        ),
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect('/admin/quests');
    }
  }

  @Post('quests/:id')
  @UseGuards(AdminSessionGuard)
  async questSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const conditionJson = parseJsonObject<QuestConditionJson>(
        body.conditionJson,
        'conditionJson',
      );
      const rewardJson = parseJsonObject<QuestRewardJson>(
        body.rewardJson ?? '{}',
        'rewardJson',
      );
      await this.catalog.updateQuest(id, {
        code: String(body.code ?? '').trim(),
        name: String(body.name ?? '').trim(),
        description: String(body.description ?? ''),
        detail: String(body.detail ?? ''),
        cadence: body.cadence as QuestCadence,
        category: body.category as QuestCategory,
        status: body.status as QuestDefinitionStatus,
        conditionType: body.conditionType as QuestConditionType,
        conditionJson,
        rewardJson,
        sortOrder: num(body.sortOrder),
        isOptional: checked(body.isOptional),
        startsAt: optDate(body.startsAt),
        endsAt: optDate(body.endsAt),
      });
      return res.redirect(`/admin/quests/${id}?ok=1`);
    } catch (e) {
      return res.redirect(
        `/admin/quests/${id}?err=${encodeURIComponent(adminErrMessage(e, 'Save failed'))}`,
      );
    }
  }

  @Post('quests/:id/delete')
  @UseGuards(AdminSessionGuard)
  async questDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.catalog.deleteQuest(id);
      return res.redirect('/admin/quests?ok=deleted');
    } catch (e) {
      return res.redirect(
        `/admin/quests/${id}?err=${encodeURIComponent(adminErrMessage(e, 'Delete failed'))}`,
      );
    }
  }

  @Get('wheel')
  @UseGuards(AdminSessionGuard)
  @Render('wheel')
  async wheel(@Req() req: AdminRequest) {
    const rows = (await this.catalog.listWheelCampaigns()).map((c) => ({
      ...c,
      isLive: c.status === WheelCampaignStatus.Active,
    }));
    return {
      title: 'Lucky Wheel',
      email: req.session.adminEmail ?? '',
      navWheel: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
    };
  }

  @Get('wheel/:id')
  @UseGuards(AdminSessionGuard)
  async wheelDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
  ) {
    try {
      const { campaign, segments } = await this.catalog.getWheelCampaign(id);
      return res.render('wheel-detail', {
        title: campaign.slug,
        email: req.session.adminEmail ?? '',
        navWheel: true,
        campaign,
        segments,
        hasSegments: segments.length > 0,
        statuses: selectOpts(
          Object.values(WheelCampaignStatus),
          campaign.status,
        ),
        flashOk: ok === '1' ? 'Saved.' : null,
        flashErr: null,
      });
    } catch {
      return res.redirect('/admin/wheel');
    }
  }

  @Post('wheel/:id')
  @UseGuards(AdminSessionGuard)
  async wheelSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.catalog.updateWheelCampaign(id, {
        status: body.status as WheelCampaignStatus,
        maxFreeSpinsPerDay: num(body.maxFreeSpinsPerDay, 1),
        maxPaidRespinsPerDay: num(body.maxPaidRespinsPerDay, 1),
        respinGemPrice: num(body.respinGemPrice, 25),
        segmentCount: num(body.segmentCount, 6),
      });
      return res.redirect(`/admin/wheel/${id}?ok=1`);
    } catch {
      return res.redirect('/admin/wheel');
    }
  }

  @Post('wheel/segments/:id')
  @UseGuards(AdminSessionGuard)
  async wheelSegmentSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const updated = await this.catalog.updateWheelSegment(id, {
        weight: String(body.weight ?? '1'),
        sortOrder: num(body.sortOrder),
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/wheel/${updated.campaignId}?ok=1`);
    } catch {
      return res.redirect('/admin/wheel');
    }
  }

  @Get('units')
  @UseGuards(AdminSessionGuard)
  @Render('units')
  async unitsPage(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
    @Query('msg') msg?: string,
  ) {
    const units = await this.unitsCatalog.listActiveUnits();
    const skills = await this.unitsCatalog.listActiveSkills();
    const byStack = new Map<
      string,
      {
        stack: string;
        units: typeof units;
      }
    >();
    for (const unit of units) {
      const key = unit.stack || 'uncategorized';
      const group = byStack.get(key);
      if (group) group.units.push(unit);
      else byStack.set(key, { stack: key, units: [unit] });
    }
    const unitGroups = [...byStack.values()].map((g) => ({
      stack: g.stack,
      count: g.units.length,
      countSingular: g.units.length === 1,
      units: g.units,
    }));
    return {
      title: 'Units',
      email: req.session.adminEmail ?? '',
      navUnits: true,
      units,
      unitGroups,
      skills: skills.map((s) => ({
        ...s,
        prerequisitesLabel: (s.prerequisites ?? []).join(', ') || '—',
      })),
      unitCount: units.length,
      unitCountSingular: units.length === 1,
      skillCount: skills.length,
      skillCountSingular: skills.length === 1,
      flashOk:
        ok === 'imported'
          ? msg
            ? `Imported: ${msg}`
            : 'Units package imported.'
          : ok === 'removed'
            ? msg
              ? `Removed unit: ${msg}`
              : 'Unit removed.'
            : ok === 'bulk-removed'
              ? `Removed ${msg ?? '0'} unit${msg === '1' ? '' : 's'}.`
              : null,
      flashErr: flashQuery(err),
      samplePayload: '',
    };
  }

  @Post('units/import')
  @UseGuards(AdminSessionGuard)
  async unitsImport(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const raw = String(body.payload ?? '').trim();
      const parsed = JSON.parse(raw) as unknown;
      if (!isUnitsJsonDocument(parsed)) {
        return res.redirect(
          `/admin/units?tab=import&err=${encodeURIComponent('Invalid JSON: need skills_index + units')}`,
        );
      }
      const result = await this.unitsCatalog.importDocument(parsed, {
        deactivateMissing: checked(body.deactivateMissing),
      });
      return res.redirect(
        `/admin/units?ok=imported&msg=${encodeURIComponent(`${result.skills} skills, ${result.units} units`)}`,
      );
    } catch (e) {
      const msg =
        e instanceof UnitsGraphError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Import failed';
      return res.redirect(
        `/admin/units?tab=import&err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('units/bulk-remove')
  @UseGuards(AdminSessionGuard)
  async unitsBulkRemove(
    @Body() body: Record<string, string | string[]>,
    @Res() res: Response,
  ) {
    const raw = body.ids;
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
    if (!ids.length) {
      return res.redirect(
        `/admin/units?err=${encodeURIComponent('Select at least one unit to delete')}`,
      );
    }
    try {
      const removed = await this.unitsCatalog.removeUnits(ids);
      return res.redirect(`/admin/units?ok=bulk-removed&msg=${removed}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Bulk delete failed';
      return res.redirect(`/admin/units?err=${encodeURIComponent(message)}`);
    }
  }

  @Get('units/example.json')
  @UseGuards(AdminSessionGuard)
  unitsExampleDownload(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="units-example.json"',
    );
    return res.send(JSON.stringify(EXAMPLE_UNITS_DOCUMENT, null, 2));
  }

  @Get('units/export.json')
  @UseGuards(AdminSessionGuard)
  async unitsExportDownload(@Res() res: Response) {
    const doc = await this.unitsCatalog.exportDocument();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="units-export.json"',
    );
    return res.send(JSON.stringify(doc, null, 2));
  }

  @Get('units/skills/:id')
  @UseGuards(AdminSessionGuard)
  async unitsSkillDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const skill = await this.unitsCatalog.getSkillById(id);
    if (!skill) {
      return res.redirect(
        `/admin/units?tab=skills&err=${encodeURIComponent(`Skill "${id}" not found`)}`,
      );
    }
    const allSkills = await this.unitsCatalog.listActiveSkills();
    const taughtBy = await this.unitsCatalog.listUnitsForSkill(id);
    const flashMap: Record<string, string> = {
      '1': 'Skill saved.',
      activated: 'Skill activated.',
      deactivated: 'Skill deactivated.',
    };
    return res.render('units-skill-detail', {
      title: skill.title,
      email: req.session.adminEmail ?? '',
      navUnits: true,
      skill: {
        ...skill,
        prerequisitesCsv: (skill.prerequisites ?? []).join(', '),
      },
      otherSkills: allSkills.filter((s) => s.id !== id),
      taughtBy,
      hasTaughtBy: taughtBy.length > 0,
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    });
  }

  @Post('units/skills/:id')
  @UseGuards(AdminSessionGuard)
  async unitsSkillSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.unitsCatalog.upsertSkill({
        id,
        title: String(body.title ?? '').trim() || id,
        prerequisites: csvList(body.prerequisites),
        level: num(body.level, 1),
      });
      if (!checked(body.isActive)) {
        await this.unitsCatalog.setSkillActive(id, false);
      }
      return res.redirect(`/admin/units/skills/${id}?ok=1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/units/skills/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('units/skills/:id/active')
  @UseGuards(AdminSessionGuard)
  async unitsSkillToggleActive(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const active = checked(body.active);
    await this.unitsCatalog.setSkillActive(id, active);
    return res.redirect(
      `/admin/units/skills/${id}?ok=${active ? 'activated' : 'deactivated'}`,
    );
  }

  @Get('units/:id')
  @UseGuards(AdminSessionGuard)
  async unitDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const unit = await this.unitsCatalog.getUnitById(id);
    if (!unit) {
      return res.redirect(
        `/admin/units?err=${encodeURIComponent(`Unit "${id}" not found`)}`,
      );
    }
    const skills = await this.unitsCatalog.listActiveSkills();
    const flashMap: Record<string, string> = {
      '1': 'Unit saved.',
      activated: 'Unit activated.',
      deactivated: 'Unit deactivated.',
    };
    return res.render('unit-detail', {
      title: unit.title,
      email: req.session.adminEmail ?? '',
      navUnits: true,
      unit: {
        ...unit,
        skillsTaughtCsv: (unit.skillsTaught ?? []).join(', '),
        prerequisitesCsv: (unit.prerequisites ?? []).join(', '),
        formatsCsv: (unit.formats ?? []).join(', '),
        servesStageCsv: (unit.servesStage ?? []).join(', '),
        contentJson: JSON.stringify(unit.content ?? {}, null, 2),
      },
      skills,
      lessonTypes: [
        'reading',
        'video',
        'practice',
        'interactive',
        'mini_project',
        'quiz',
      ].map((t) => ({ value: t, selected: t === unit.lessonType })),
      unitRoles: [
        'foundation',
        'refresher',
        'checkpoint',
        'project',
        'proof',
      ].map((r) => ({
        value: r,
        selected: r === (unit.unitRole ?? 'foundation'),
      })),
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    });
  }

  @Post('units/:id')
  @UseGuards(AdminSessionGuard)
  async unitSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(String(body.content ?? '{}')) as Record<
          string,
          unknown
        >;
      } catch {
        return res.redirect(
          `/admin/units/${id}?err=${encodeURIComponent('Content is not valid JSON')}`,
        );
      }
      const existing = await this.unitsCatalog.getUnitById(id);
      const servesStage = csvList(body.servesStage)
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n >= 1);
      await this.unitsCatalog.upsertUnit({
        id,
        title: String(body.title ?? '').trim() || id,
        skills_taught: csvList(body.skillsTaught),
        prerequisites: csvList(body.prerequisites),
        level: num(body.level, 1),
        estimated_minutes: num(body.estimatedMinutes, 20),
        formats: csvList(body.formats),
        lesson_type: String(body.lessonType ?? 'reading'),
        domain: String(body.domain ?? 'frontend').trim() || 'frontend',
        stack: String(body.stack ?? '').trim(),
        provider: String(body.provider ?? '').trim() || null,
        url: String(body.url ?? '').trim() || null,
        xp: num(body.xp, 20),
        content,
        serves_stage: servesStage.length ? servesStage : [num(body.level, 1)],
        unit_role: String(body.unitRole ?? 'foundation').trim() || 'foundation',
        profile_skill_slug: String(body.profileSkillSlug ?? '').trim() || null,
        source_template_id: existing?.sourceTemplateId ?? null,
        source_version_id: existing?.sourceVersionId ?? null,
      });
      if (!checked(body.isActive)) {
        await this.unitsCatalog.setUnitActive(id, false);
      }
      return res.redirect(`/admin/units/${id}?ok=1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(`/admin/units/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('units/:id/active')
  @UseGuards(AdminSessionGuard)
  async unitToggleActive(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    const active = checked(body.active);
    await this.unitsCatalog.setUnitActive(id, active);
    return res.redirect(
      `/admin/units/${id}?ok=${active ? 'activated' : 'deactivated'}`,
    );
  }

  @Post('units/:id/remove')
  @UseGuards(AdminSessionGuard)
  async unitRemove(@Param('id') id: string, @Res() res: Response) {
    try {
      const removed = await this.unitsCatalog.removeUnit(id);
      if (!removed) {
        return res.redirect(
          `/admin/units?err=${encodeURIComponent(`Unit "${id}" not found`)}`,
        );
      }
      return res.redirect(
        `/admin/units?ok=removed&msg=${encodeURIComponent(id)}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Remove failed';
      return res.redirect(
        `/admin/units/${id}?err=${encodeURIComponent(message)}`,
      );
    }
  }

  @Get('courses')
  @UseGuards(AdminSessionGuard)
  coursesRedirect(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Get('courses/:id')
  @UseGuards(AdminSessionGuard)
  courseDetailRedirect(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  /** @deprecated course templates superseded by flattened units */
  @Post('courses')
  @UseGuards(AdminSessionGuard)
  courseCreateDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('courses/:id')
  @UseGuards(AdminSessionGuard)
  courseSaveDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('courses/:id/modules')
  @UseGuards(AdminSessionGuard)
  moduleCreateDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Get('datasets')
  @UseGuards(AdminSessionGuard)
  @Render('datasets')
  async datasets(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = await this.catalog.listDatasets();
    return {
      title: 'Datasets',
      email: req.session.adminEmail ?? '',
      navDatasets: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      flashOk: ok === '1' ? 'Dataset created.' : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('datasets')
  @UseGuards(AdminSessionGuard)
  async datasetCreate(
    @Body() body: Record<string, string>,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    try {
      const slug = String(body.slug ?? '').trim();
      const title = String(body.title ?? '').trim();
      const storageKey = String(body.storageKey ?? '').trim();
      const checksum = String(body.checksum ?? '').trim();
      if (!slug || !title || !storageKey || !checksum) {
        return res.redirect(
          `/admin/datasets?err=${encodeURIComponent('Slug, title, storage key, checksum required')}`,
        );
      }
      await this.catalog.createDataset({
        slug,
        title,
        storageKey,
        checksum,
        format: String(body.format ?? 'csv').trim() || 'csv',
        actorId: req.session.adminUserId,
      });
      return res.redirect('/admin/datasets?ok=1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      return res.redirect(`/admin/datasets?err=${encodeURIComponent(msg)}`);
    }
  }

  @Get('roles')
  @UseGuards(AdminSessionGuard)
  @Render('roles')
  async roles(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = await this.rolesAdmin.listRoles();
    const flashMap: Record<string, string> = {
      '1': 'Role created and added to questionnaire goal step.',
      sync: 'Active roles synced to questionnaire.',
      off: 'Role deactivated.',
      on: 'Role activated.',
    };
    return {
      title: 'Roles',
      email: req.session.adminEmail ?? '',
      navRoles: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      icons: this.rolesAdmin.iconChoices(),
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('roles')
  @UseGuards(AdminSessionGuard)
  async roleCreate(@Body() body: Record<string, string>, @Res() res: Response) {
    try {
      await this.rolesAdmin.createRole({
        title: String(body.title ?? ''),
        slug: String(body.slug ?? ''),
        description: String(body.description ?? ''),
        category: String(body.category ?? 'career'),
        icon: String(body.icon ?? 'briefcase'),
        addToQuestionnaire:
          body.addToQuestionnaire === undefined
            ? true
            : checked(body.addToQuestionnaire),
      });
      return res.redirect('/admin/roles?ok=1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      return res.redirect(`/admin/roles?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('roles/sync')
  @UseGuards(AdminSessionGuard)
  async roleSync(@Res() res: Response) {
    try {
      await this.rolesAdmin.syncActiveRolesToQuestionnaire();
      return res.redirect('/admin/roles?ok=sync');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      return res.redirect(`/admin/roles?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('roles/:id/activate')
  @UseGuards(AdminSessionGuard)
  async roleActivate(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.rolesAdmin.setActive(id, true);
      return res.redirect('/admin/roles?ok=on');
    } catch {
      return res.redirect('/admin/roles');
    }
  }

  @Post('roles/:id/deactivate')
  @UseGuards(AdminSessionGuard)
  async roleDeactivate(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.rolesAdmin.setActive(id, false);
      return res.redirect('/admin/roles?ok=off');
    } catch {
      return res.redirect('/admin/roles');
    }
  }

  @Get('questionnaire')
  @UseGuards(AdminSessionGuard)
  @Render('questionnaire')
  async questionnaire(@Req() req: AdminRequest) {
    const rows = (await this.catalog.listQuestionnaires()).map((q) => ({
      id: q.id,
      version: q.version,
      isActive: q.isActive,
      stepCount: q.steps?.length ?? 0,
      aiEnrichedAt: fmtDate(q.aiEnrichedAt),
    }));
    return {
      title: 'Questionnaire',
      email: req.session.adminEmail ?? '',
      navQuestionnaire: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
    };
  }

  @Get('questionnaire/roles')
  @UseGuards(AdminSessionGuard)
  @Render('questionnaire-roles')
  async questionnaireRoles(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = await this.rolesAdmin.listGoalOptions();
    const flashMap: Record<string, string> = {
      created: 'Questionnaire role created.',
      saved: 'Questionnaire role saved.',
      deleted: 'Questionnaire role deleted.',
    };
    return {
      title: 'Questionnaire roles',
      email: req.session.adminEmail ?? '',
      navQuestionnaireRoles: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      icons: this.rolesAdmin.iconChoices(),
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: flashQuery(err),
    };
  }

  @Post('questionnaire/roles')
  @UseGuards(AdminSessionGuard)
  async questionnaireRoleCreate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.rolesAdmin.createGoalOption({
        label: String(body.label ?? ''),
        value: String(body.value ?? ''),
        icon: String(body.icon ?? 'briefcase'),
        sortOrder:
          body.sortOrder === '' || body.sortOrder === undefined
            ? undefined
            : num(body.sortOrder),
      });
      return res.redirect('/admin/questionnaire/roles?ok=created');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      return res.redirect(
        `/admin/questionnaire/roles?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('questionnaire/roles/:id')
  @UseGuards(AdminSessionGuard)
  async questionnaireRoleDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const row = await this.rolesAdmin.getGoalOption(id);
      return res.render('questionnaire-role-detail', {
        title: row.label,
        email: req.session.adminEmail ?? '',
        navQuestionnaireRoles: true,
        row: {
          ...row,
          icon: row.icon ?? 'briefcase',
        },
        icons: this.rolesAdmin.iconChoices(row.icon),
        flashOk: ok === 'saved' ? 'Saved.' : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect('/admin/questionnaire/roles');
    }
  }

  @Post('questionnaire/roles/:id')
  @UseGuards(AdminSessionGuard)
  async questionnaireRoleSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.rolesAdmin.updateGoalOption(id, {
        label: String(body.label ?? ''),
        value: String(body.value ?? ''),
        icon: String(body.icon ?? 'briefcase'),
        sortOrder: num(body.sortOrder),
      });
      return res.redirect(`/admin/questionnaire/roles/${id}?ok=saved`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/questionnaire/roles/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('questionnaire/roles/:id/delete')
  @UseGuards(AdminSessionGuard)
  async questionnaireRoleDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.rolesAdmin.deleteGoalOption(id);
      return res.redirect('/admin/questionnaire/roles?ok=deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(
        `/admin/questionnaire/roles?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('questionnaire/:id')
  @UseGuards(AdminSessionGuard)
  async questionnaireDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    if (id === 'roles') {
      return res.redirect('/admin/questionnaire/roles');
    }
    try {
      const row = await this.questionnaireAdmin.getDefinition(id);
      const steps = (row.steps ?? []).map((s) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        fieldKey: s.fieldKey,
        title: s.title,
        selection: s.selection,
        uiKind: s.uiKind,
        optionCount: s.options?.length ?? 0,
      }));
      const flashMap: Record<string, string> = {
        '1': 'Version activated.',
        activated: 'Version activated.',
        'step-created': 'Step created.',
        'step-deleted': 'Step deleted.',
      };
      return res.render('questionnaire-detail', {
        title: `Questionnaire v${row.version}`,
        email: req.session.adminEmail ?? '',
        navQuestionnaire: true,
        row,
        steps,
        hasSteps: steps.length > 0,
        stepCount: steps.length,
        stepCountSingular: steps.length === 1,
        uiKinds: selectOpts(QUESTIONNAIRE_UI_KINDS, 'options'),
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect('/admin/questionnaire');
    }
  }

  @Post('questionnaire/:id/activate')
  @UseGuards(AdminSessionGuard)
  async questionnaireActivate(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.questionnaireAdmin.activate(id);
      return res.redirect(`/admin/questionnaire/${id}?ok=activated`);
    } catch (e) {
      const msg = adminErrMessage(e, 'Activation failed');
      return res.redirect(
        `/admin/questionnaire/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('questionnaire/:id/steps')
  @UseGuards(AdminSessionGuard)
  async questionnaireStepCreate(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const step = await this.questionnaireAdmin.createStep(id, {
        fieldKey: String(body.fieldKey ?? ''),
        title: String(body.title ?? ''),
        subtitle: String(body.subtitle ?? ''),
        selection: String(body.selection ?? 'multi'),
        uiKind: String(body.uiKind ?? 'options'),
        allowOther: checked(body.allowOther),
        reviewLabel: String(body.reviewLabel ?? ''),
        reviewIcon: String(body.reviewIcon ?? 'target'),
        stepNumber:
          body.stepNumber === '' || body.stepNumber === undefined
            ? undefined
            : num(body.stepNumber),
      });
      return res.redirect(
        `/admin/questionnaire/${id}/steps/${step.id}?ok=created`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create step failed';
      return res.redirect(
        `/admin/questionnaire/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('questionnaire/:defId/steps/:stepId')
  @UseGuards(AdminSessionGuard)
  async questionnaireStepDetail(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const step = await this.questionnaireAdmin.getStep(stepId);
      if (step.definitionId !== defId) {
        return res.redirect(
          `/admin/questionnaire/${step.definitionId}/steps/${stepId}`,
        );
      }
      const options = (step.options ?? []).map((o) => ({
        id: o.id,
        value: o.value,
        label: o.label,
        icon: o.icon ?? '',
        sortOrder: o.sortOrder,
      }));
      const flashMap: Record<string, string> = {
        created: 'Step created.',
        saved: 'Step saved.',
        'option-created': 'Option created.',
        'option-saved': 'Option saved.',
        'option-deleted': 'Option deleted.',
      };
      return res.render('questionnaire-step-detail', {
        title: step.title,
        email: req.session.adminEmail ?? '',
        navQuestionnaire: true,
        defId,
        step: {
          id: step.id,
          fieldKey: step.fieldKey,
          stepNumber: step.stepNumber,
          title: step.title,
          subtitle: step.subtitle,
          selection: step.selection,
          uiKind: step.uiKind,
          allowOther: step.allowOther,
          reviewLabel: step.reviewLabel,
          reviewIcon: step.reviewIcon,
          scheduleDays: (step.scheduleDays ?? []).join(', '),
          scheduleTimesJson: step.scheduleTimes
            ? JSON.stringify(step.scheduleTimes, null, 2)
            : '',
          exposureOptionsJson: step.exposureOptions
            ? JSON.stringify(step.exposureOptions, null, 2)
            : '',
          sessionOptionsJson: step.sessionOptions
            ? JSON.stringify(step.sessionOptions, null, 2)
            : '',
          secondaryOptionsJson: step.secondaryOptions
            ? JSON.stringify(step.secondaryOptions, null, 2)
            : '',
          isSchedule: step.uiKind === 'schedule',
          isOptions: step.uiKind !== 'schedule',
          selectionSingle: step.selection === 'single',
          selectionMulti: step.selection === 'multi',
        },
        options,
        hasOptions: options.length > 0,
        icons: this.questionnaireAdmin.iconChoices(step.reviewIcon),
        optionIcons: this.questionnaireAdmin.iconChoices(),
        uiKinds: selectOpts(QUESTIONNAIRE_UI_KINDS, step.uiKind),
        backHref: `/admin/questionnaire/${defId}`,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect(`/admin/questionnaire/${defId}`);
    }
  }

  @Post('questionnaire/:defId/steps/:stepId')
  @UseGuards(AdminSessionGuard)
  async questionnaireStepSave(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.questionnaireAdmin.updateStep(stepId, {
        fieldKey: String(body.fieldKey ?? ''),
        title: String(body.title ?? ''),
        subtitle: String(body.subtitle ?? ''),
        selection: String(body.selection ?? 'multi'),
        uiKind: String(body.uiKind ?? 'options'),
        allowOther: checked(body.allowOther),
        reviewLabel: String(body.reviewLabel ?? ''),
        reviewIcon: String(body.reviewIcon ?? 'target'),
        stepNumber: num(body.stepNumber),
        scheduleDays: body.scheduleDays,
        scheduleTimesJson: body.scheduleTimesJson,
        exposureOptionsJson: body.exposureOptionsJson,
        sessionOptionsJson: body.sessionOptionsJson,
        secondaryOptionsJson: body.secondaryOptionsJson,
      });
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}?ok=saved`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('questionnaire/:defId/steps/:stepId/delete')
  @UseGuards(AdminSessionGuard)
  async questionnaireStepDelete(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Res() res: Response,
  ) {
    try {
      await this.questionnaireAdmin.deleteStep(stepId);
      return res.redirect(`/admin/questionnaire/${defId}?ok=step-deleted`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(
        `/admin/questionnaire/${defId}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('questionnaire/:defId/steps/:stepId/options')
  @UseGuards(AdminSessionGuard)
  async questionnaireOptionCreate(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.questionnaireAdmin.createOption(stepId, {
        label: String(body.label ?? ''),
        value: String(body.value ?? ''),
        icon: String(body.icon ?? ''),
        sortOrder:
          body.sortOrder === '' || body.sortOrder === undefined
            ? undefined
            : num(body.sortOrder),
      });
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}?ok=option-created`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create option failed';
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('questionnaire/:defId/steps/:stepId/options/:optionId')
  @UseGuards(AdminSessionGuard)
  async questionnaireOptionDetail(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Param('optionId') optionId: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const step = await this.questionnaireAdmin.getStep(stepId);
      const opt = (step.options ?? []).find((o) => o.id === optionId);
      if (!opt) throw new Error('missing');
      return res.render('questionnaire-option-detail', {
        title: opt.label,
        email: req.session.adminEmail ?? '',
        navQuestionnaire: true,
        defId,
        stepId,
        stepFieldKey: step.fieldKey,
        row: {
          id: opt.id,
          label: opt.label,
          value: opt.value,
          icon: opt.icon ?? '',
          sortOrder: opt.sortOrder,
          profileSignalJson: opt.profileSignal
            ? JSON.stringify(opt.profileSignal, null, 2)
            : '',
        },
        icons: this.questionnaireAdmin.iconChoices(opt.icon),
        backHref: `/admin/questionnaire/${defId}/steps/${stepId}`,
        flashOk: ok === 'saved' ? 'Option saved.' : null,
        flashErr: flashQuery(err),
      });
    } catch {
      return res.redirect(`/admin/questionnaire/${defId}/steps/${stepId}`);
    }
  }

  @Post('questionnaire/:defId/steps/:stepId/options/:optionId')
  @UseGuards(AdminSessionGuard)
  async questionnaireOptionSave(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Param('optionId') optionId: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.questionnaireAdmin.updateOption(optionId, {
        label: String(body.label ?? ''),
        value: String(body.value ?? ''),
        icon: String(body.icon ?? ''),
        sortOrder: num(body.sortOrder),
        profileSignalJson: body.profileSignalJson,
      });
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}/options/${optionId}?ok=saved`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}/options/${optionId}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('questionnaire/:defId/steps/:stepId/options/:optionId/delete')
  @UseGuards(AdminSessionGuard)
  async questionnaireOptionDelete(
    @Param('defId') defId: string,
    @Param('stepId') stepId: string,
    @Param('optionId') optionId: string,
    @Res() res: Response,
  ) {
    try {
      await this.questionnaireAdmin.deleteOption(optionId);
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}?ok=option-deleted`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(
        `/admin/questionnaire/${defId}/steps/${stepId}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('feature-flags')
  @UseGuards(AdminSessionGuard)
  @Render('feature-flags')
  async featureFlagsPage(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = await this.systemFlags.list();
    const flags = rows.map((row) => {
      const flagKey = row.key as (typeof SystemFlagKey)[keyof typeof SystemFlagKey];
      const options = this.systemFlags.optionsFor(flagKey);
      const isBoolean = row.valueType === 'boolean';
      const isMultiSelect = this.systemFlags.isMultiSelect(flagKey);
      const selectedSet = isMultiSelect
        ? new Set(this.systemFlags.parseCsvList(row.value))
        : null;
      return {
        key: row.key,
        label: row.label,
        description: row.description,
        isBoolean,
        isMultiSelect,
        boolOn: isBoolean && row.value === 'true',
        options: options
          ? options.map((value) => ({
              value,
              label: this.systemFlags.optionLabel(flagKey, value),
              selected: selectedSet
                ? selectedSet.has(value.toLowerCase())
                : value === row.value,
            }))
          : [],
        updatedAt: fmtDate(row.updatedAt) ?? '—',
      };
    });
    const catalog = llmAdminCatalog();
    const openRouterFree = await this.llm.listOpenRouterFreeModels();
    if (openRouterFree.length > 0) {
      catalog.byProvider.openrouter = openRouterFree;
      if (
        !openRouterFree.some((m) => m.id === catalog.defaults.openrouter)
      ) {
        catalog.defaults.openrouter = openRouterFree[0].id;
      }
    }
    return {
      title: 'Feature flags',
      email: req.session.adminEmail ?? '',
      navFeatureFlags: true,
      flags,
      flashOk: ok === '1' ? 'Feature flags saved.' : null,
      flashErr: flashQuery(err),
      llmCatalogJson: JSON.stringify({
        ...catalog,
        modelFlagKeys: [
          SystemFlagKey.LLM_INTAKE_MODEL,
          SystemFlagKey.LLM_ROADMAP_MODEL,
          SystemFlagKey.LLM_ARLO_MODEL,
          SystemFlagKey.LLM_BATTLE_MODEL,
          SystemFlagKey.LLM_LESSON_BODY_MODEL,
        ],
        providerFlagKey: SystemFlagKey.LLM_PROVIDER,
      }),
    };
  }

  @Post('feature-flags')
  @UseGuards(AdminSessionGuard)
  async featureFlagsSave(
    @Body() body: Record<string, string | string[]>,
    @Res() res: Response,
  ) {
    try {
      const known = Object.values(SystemFlagKey);
      const updates: Record<string, string> = {};
      for (const key of known) {
        const raw = body[key];
        if (raw === undefined) continue;
        if (this.systemFlags.isMultiSelect(key)) {
          const parts = (Array.isArray(raw) ? raw : [raw])
            .map((v) => String(v).trim())
            .filter(Boolean);
          updates[key] = parts.join(',');
          continue;
        }
        if (Array.isArray(raw)) {
          updates[key] = raw.includes('true')
            ? 'true'
            : String(raw.at(-1) ?? 'false');
        } else {
          updates[key] = String(raw);
        }
      }
      await this.systemFlags.setMany(updates);
      return res.redirect('/admin/feature-flags?ok=1');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/feature-flags?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('goals')
  @UseGuards(AdminSessionGuard)
  @Render('goals')
  async goals(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    const statusFilter =
      status === 'all' ||
      status === GoalStatus.Active ||
      status === GoalStatus.Archived ||
      status === GoalStatus.Completed
        ? status
        : GoalStatus.Active;
    const [rows, domains] = await Promise.all([
      this.goalsAdmin.list({ status: statusFilter, q }),
      this.goalsAdmin.listDomains(),
    ]);
    return {
      title: 'Goals',
      email: req.session.adminEmail ?? '',
      navGoals: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      q: q ?? '',
      statusOptions: [
        {
          value: 'active',
          label: 'Active',
          selected: statusFilter === 'active',
        },
        {
          value: 'archived',
          label: 'Archived',
          selected: statusFilter === 'archived',
        },
        {
          value: 'completed',
          label: 'Completed',
          selected: statusFilter === 'completed',
        },
        { value: 'all', label: 'All', selected: statusFilter === 'all' },
      ],
      domains,
      hasDomains: domains.length > 0,
      flashOk: ok === '1' ? 'Goal saved.' : null,
      flashErr: flashQuery(err),
    };
  }

  @Get('goals/:id')
  @UseGuards(AdminSessionGuard)
  async goalDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const row = await this.goalsAdmin.get(id);
    if (!row) return res.redirect('/admin/goals');
    const domains = await this.goalsAdmin.listDomains();
    return res.render('goal-detail', {
      title: 'Goal',
      email: req.session.adminEmail ?? '',
      navGoals: true,
      row,
      rolesCsv: row.targetRoles.join(', '),
      statusOptions: [
        {
          value: GoalStatus.Active,
          label: 'Active',
          selected: row.status === GoalStatus.Active,
        },
        {
          value: GoalStatus.Archived,
          label: 'Archived',
          selected: row.status === GoalStatus.Archived,
        },
        {
          value: GoalStatus.Completed,
          label: 'Completed',
          selected: row.status === GoalStatus.Completed,
        },
      ],
      domains,
      hasDomains: domains.length > 0,
      flashOk: ok === '1' ? 'Goal saved.' : null,
      flashErr: flashQuery(err),
    });
  }

  @Post('goals/:id')
  @UseGuards(AdminSessionGuard)
  async goalSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const statusRaw = String(body.status ?? GoalStatus.Active).trim();
      const status = Object.values(GoalStatus).includes(statusRaw as GoalStatus)
        ? (statusRaw as GoalStatus)
        : GoalStatus.Active;
      await this.goalsAdmin.update(id, {
        targetRoles: csvList(body.targetRoles),
        status,
        weeklyHours: String(body.weeklyHours ?? '').trim() || null,
        targetDeadline: String(body.targetDeadline ?? '').trim() || null,
        confidence: String(body.confidence ?? '').trim() || null,
      });
      return res.redirect(`/admin/goals/${id}?ok=1`);
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : e instanceof Error
            ? e.message
            : 'Save failed';
      return res.redirect(`/admin/goals/${id}?err=${encodeURIComponent(msg)}`);
    }
  }

  @Get('roadmap-engine')
  @UseGuards(AdminSessionGuard)
  async roadmapEnginePage(@Req() req: AdminRequest, @Res() res: Response) {
    const [health, goals, config] = await Promise.all([
      this.roadmapEngineAdmin.checkHealth(),
      this.roadmapEngineAdmin.listRecentGoals(),
      this.roadmapEngineAdmin.configSummary(),
    ]);
    return res.render('roadmap-engine', {
      title: 'Roadmap Engine',
      email: req.session.adminEmail ?? '',
      navRoadmapEngine: true,
      health,
      config,
      goals: goals.map((g) => ({ ...g, selected: false })),
      goalIdManual: '',
      hasResult: false,
      result: null,
      phaseTitles: [],
      hasPhaseTitles: false,
      flashOk: null,
      flashErr: null,
    });
  }

  @Post('roadmap-engine/test')
  @UseGuards(AdminSessionGuard)
  async roadmapEngineTest(
    @Body() body: { goalId?: string; goalIdManual?: string },
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    const goalId = body.goalIdManual?.trim() || body.goalId?.trim() || '';
    const [health, goals, config] = await Promise.all([
      this.roadmapEngineAdmin.checkHealth(),
      this.roadmapEngineAdmin.listRecentGoals(),
      this.roadmapEngineAdmin.configSummary(),
    ]);

    if (!goalId) {
      return res.render('roadmap-engine', {
        title: 'Roadmap Engine',
        email: req.session.adminEmail ?? '',
        navRoadmapEngine: true,
        health,
        config,
        goals: goals.map((g) => ({ ...g, selected: false })),
        goalIdManual: '',
        hasResult: false,
        result: null,
        phaseTitles: [],
        hasPhaseTitles: false,
        flashOk: null,
        flashErr: 'Pick a goal or paste a goal UUID.',
      });
    }

    const result = await this.roadmapEngineAdmin.dryRunPlan(goalId);
    const phaseTitles =
      (result.summary?.phaseTitles as
        | Array<{ title: string; weekType: string; milestones: number }>
        | undefined) ?? [];
    return res.render('roadmap-engine', {
      title: 'Roadmap Engine',
      email: req.session.adminEmail ?? '',
      navRoadmapEngine: true,
      health,
      config,
      goals: goals.map((g) => ({
        ...g,
        selected: g.id === goalId,
      })),
      goalIdManual: body.goalIdManual?.trim() || '',
      hasResult: true,
      result: {
        ok: result.ok,
        error: result.error,
        rawJson: result.rawJson,
        summary: result.summary
          ? {
              recipe: result.summary.recipe,
              phaseCount: result.summary.phaseCount,
              lessonCount: result.summary.lessonCount,
              estimatedWeeks: result.summary.estimatedWeeks,
              seed: result.summary.seed,
            }
          : null,
      },
      phaseTitles,
      hasPhaseTitles: phaseTitles.length > 0,
      flashOk: result.ok ? 'Dry-run plan succeeded.' : null,
      flashErr: result.ok ? null : result.error,
    });
  }

  /** @deprecated skill-graph UI superseded by flattened units */
  @Get('skill-graph')
  @UseGuards(AdminSessionGuard)
  skillGraphRedirect(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Get('skill-graph/stacks/:id')
  @UseGuards(AdminSessionGuard)
  skillGraphStackRedirect(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Get('skill-graph/skills/:id')
  @UseGuards(AdminSessionGuard)
  skillGraphSkillRedirect(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Get('skill-graph/lessons/:id')
  @UseGuards(AdminSessionGuard)
  skillGraphLessonRedirect(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/import')
  @UseGuards(AdminSessionGuard)
  skillGraphImportDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/stacks')
  @UseGuards(AdminSessionGuard)
  skillGraphStackCreateDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/stacks/:id')
  @UseGuards(AdminSessionGuard)
  skillGraphStackSaveDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/stacks/:id/delete')
  @UseGuards(AdminSessionGuard)
  skillGraphStackDeleteDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/stacks/:id/skills')
  @UseGuards(AdminSessionGuard)
  skillGraphSkillCreateDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/skills/:id')
  @UseGuards(AdminSessionGuard)
  skillGraphSkillSaveDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/skills/:id/delete')
  @UseGuards(AdminSessionGuard)
  skillGraphSkillDeleteDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/skills/:id/lessons')
  @UseGuards(AdminSessionGuard)
  skillGraphLessonCreateDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/lessons/:id')
  @UseGuards(AdminSessionGuard)
  skillGraphLessonSaveDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Post('skill-graph/lessons/:id/delete')
  @UseGuards(AdminSessionGuard)
  skillGraphLessonDeleteDeprecated(@Res() res: Response) {
    return res.redirect('/admin/units');
  }

  @Get('login')
  loginForm(@Req() req: AdminRequest, @Res() res: Response) {
    if (req.session.adminUserId) {
      return res.redirect('/admin');
    }
    return res.render('login', {
      title: 'Admin login',
      error: null,
      email: '',
    });
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async loginSubmit(
    @Body() dto: AdminLoginDto,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    if (req.session.adminUserId) {
      return res.redirect('/admin');
    }

    const result = await this.adminAuth.validateLogin(dto.email, dto.password);
    if (!result.ok) {
      return res.status(401).render('login', {
        title: 'Admin login',
        error: result.error,
        email: dto.email,
      });
    }

    req.session.adminUserId = result.user.id;
    req.session.adminEmail = result.user.email;
    return await new Promise<void>((resolve) => {
      req.session.save((err) => {
        if (err) {
          res.status(500).render('login', {
            title: 'Admin login',
            error: 'Could not start session. Try again.',
            email: dto.email,
          });
          resolve();
          return;
        }
        res.redirect('/admin');
        resolve();
      });
    });
  }

  @Post('logout')
  @UseGuards(AdminSessionGuard)
  logout(@Req() req: AdminRequest, @Res() res: Response) {
    req.session.destroy(() => {
      res.clearCookie('arc_admin_sid', { path: '/admin' });
      res.redirect('/admin/login');
    });
  }
}
