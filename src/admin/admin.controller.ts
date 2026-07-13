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
  BadgeDefinitionStatus,
  BadgeRarity,
} from '../badges/badge.constants';
import { ContentPublicationStatus } from '../content-pool/content-pool.constants';
import { RewardCurrency } from '../gamification/entities/reward-ledger-entry.entity';
import { StoreItemType } from '../gamification/entities/store-item.entity';
import { WheelCampaignStatus } from '../lucky-wheel/entities/wheel.enums';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminBadgeIconService } from './admin-badge-icon.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminQuestionnaireService } from './admin-questionnaire.service';
import { AdminRolesService } from './admin-roles.service';
import { AdminRoadmapEngineService } from './admin-roadmap-engine.service';
import { AdminSkillGraphService } from './admin-skill-graph.service';
import { AdminUserResetService } from './admin-user-reset.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminSessionGuard } from './guards/admin-session.guard';
import type { AdminRequest } from './types/admin-request';

function checked(v: unknown): boolean {
  return v === '1' || v === 'on' || v === true || v === 'true';
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

function fmtDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 19).replace('T', ' ');
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
    currentRole: p?.currentRole ?? null,
    targetRole: p?.targetRole ?? null,
    yearsExperience: p?.yearsExperience ?? null,
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

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly usersService: UsersService,
    private readonly analytics: AdminAnalyticsService,
    private readonly catalog: AdminCatalogService,
    private readonly roadmapEngineAdmin: AdminRoadmapEngineService,
    private readonly badgeIcons: AdminBadgeIconService,
    private readonly rolesAdmin: AdminRolesService,
    private readonly questionnaireAdmin: AdminQuestionnaireService,
    private readonly skillGraphAdmin: AdminSkillGraphService,
    private readonly userReset: AdminUserResetService,
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
        'Questionnaire + roadmap reset. User can start questionnaire again.',
    };
    const errMap: Record<string, string> = {
      self: 'Cannot change your own account from here.',
      missing: 'User not found.',
    };

    return res.render('user-detail', {
      title: row.email,
      email: req.session.adminEmail ?? '',
      navUsers: true,
      user: toAdminUserView(row),
      isSelf: req.session.adminUserId === row.id,
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: err ? (errMap[err] ?? decodeURIComponent(err)) : null,
    });
  }

  @Post('users/:id/reset-learning')
  @UseGuards(AdminSessionGuard)
  async resetUserLearning(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      await this.userReset.resetQuestionnaireAndRoadmap(id);
      return res.redirect(`/admin/users/${id}?ok=reset`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Reset failed';
      return res.redirect(
        `/admin/users/${id}?err=${encodeURIComponent(msg)}`,
      );
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
  async ranks(@Req() req: AdminRequest) {
    const rows = await this.catalog.listRanks();
    return {
      title: 'Ranks',
      email: req.session.adminEmail ?? '',
      navRanks: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
    };
  }

  @Get('ranks/:id')
  @UseGuards(AdminSessionGuard)
  async rankDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
  ) {
    try {
      const row = await this.catalog.getRank(id);
      return res.render('rank-detail', {
        title: row.title,
        email: req.session.adminEmail ?? '',
        navRanks: true,
        row: {
          ...row,
          iconAssetKey: row.iconAssetKey ?? '',
        },
        flashOk: ok === '1' ? 'Rank saved.' : null,
        flashErr: null,
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
        title: String(body.title ?? '').trim(),
        xpThreshold: num(body.xpThreshold),
        minimumActiveDays: num(body.minimumActiveDays),
        displayOrder: num(body.displayOrder),
        iconAssetKey: String(body.iconAssetKey ?? '').trim() || null,
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/ranks/${id}?ok=1`);
    } catch {
      return res.redirect('/admin/ranks');
    }
  }

  @Get('store')
  @UseGuards(AdminSessionGuard)
  @Render('store')
  async store(@Req() req: AdminRequest) {
    const rows = await this.catalog.listStoreItems();
    return {
      title: 'Store',
      email: req.session.adminEmail ?? '',
      navStore: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
    };
  }

  @Get('store/:id')
  @UseGuards(AdminSessionGuard)
  async storeDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
  ) {
    try {
      const row = await this.catalog.getStoreItem(id);
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
        flashOk: ok === '1' ? 'Store item saved.' : null,
        flashErr: null,
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
    } catch {
      return res.redirect('/admin/store');
    }
  }

  @Get('badges')
  @UseGuards(AdminSessionGuard)
  @Render('badges')
  async badges(@Req() req: AdminRequest) {
    const rows = (await this.catalog.listBadges()).map((b) => ({
      ...b,
      isActiveStatus: b.status === BadgeDefinitionStatus.Active,
      iconThumbUrl: AdminBadgeIconService.isUploadPath(b.iconAssetKey)
        ? b.iconAssetKey
        : null,
    }));
    return {
      title: 'Badges',
      email: req.session.adminEmail ?? '',
      navBadges: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
    };
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
        icon: 'Badge image uploaded.',
        cleared: 'Badge image cleared.',
      };
      return res.render('badge-detail', {
        title: row.name,
        email: req.session.adminEmail ?? '',
        navBadges: true,
        row: { ...row, iconAssetKey: iconKey },
        iconPreviewUrl: hasUpload ? iconKey : null,
        hasUpload,
        categories: selectOpts(Object.values(BadgeCategory), row.category),
        rarities: selectOpts(Object.values(BadgeRarity), row.rarity),
        statuses: selectOpts(Object.values(BadgeDefinitionStatus), row.status),
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
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
      await this.catalog.updateBadge(id, {
        name: String(body.name ?? '').trim(),
        description: String(body.description ?? ''),
        category: body.category as BadgeCategory,
        rarity: body.rarity as BadgeRarity,
        status: body.status as BadgeDefinitionStatus,
        sortOrder: num(body.sortOrder),
        iconAssetKey: String(body.iconAssetKey ?? '').trim() || null,
        isHidden: checked(body.isHidden),
      });
      return res.redirect(`/admin/badges/${id}?ok=1`);
    } catch {
      return res.redirect('/admin/badges');
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
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : 'Upload failed';
      return res.redirect(
        `/admin/badges/${id}?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
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
      return res.redirect(`/admin/badges/${id}?err=${encodeURIComponent('Clear failed')}`);
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

  @Get('courses')
  @UseGuards(AdminSessionGuard)
  @Render('courses')
  async courses(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    const rows = await this.catalog.listCourses();
    return {
      title: 'Courses',
      email: req.session.adminEmail ?? '',
      navCourses: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      flashOk: ok === 'created' ? 'Course created.' : null,
      flashErr: err ? decodeURIComponent(err) : null,
    };
  }

  @Post('courses')
  @UseGuards(AdminSessionGuard)
  async courseCreate(
    @Body() body: Record<string, string>,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    try {
      const slug = String(body.slug ?? '').trim();
      const title = String(body.title ?? '').trim();
      if (!slug || !title) {
        return res.redirect(
          `/admin/courses?err=${encodeURIComponent('Slug and title required')}`,
        );
      }
      const row = await this.catalog.createCourse({
        slug,
        title,
        learningOutcome: String(body.learningOutcome ?? ''),
        actorId: req.session.adminUserId,
      });
      return res.redirect(`/admin/courses/${row.id}?ok=created`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      return res.redirect(`/admin/courses?err=${encodeURIComponent(msg)}`);
    }
  }

  @Get('courses/:id')
  @UseGuards(AdminSessionGuard)
  async courseDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const { course, modules } = await this.catalog.getCourse(id);
      const flashMap: Record<string, string> = {
        '1': 'Course saved.',
        created: 'Course created.',
        module: 'Module created.',
      };
      return res.render('course-detail', {
        title: course.title,
        email: req.session.adminEmail ?? '',
        navCourses: true,
        course,
        modules: modules.map((m) => ({
          ...m,
          lessonCount: m.lessonTemplateIds?.length ?? 0,
        })),
        hasModules: modules.length > 0,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
      });
    } catch {
      return res.redirect('/admin/courses');
    }
  }

  @Post('courses/:id')
  @UseGuards(AdminSessionGuard)
  async courseSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.catalog.updateCourse(id, {
        title: String(body.title ?? '').trim(),
        learningOutcome: String(body.learningOutcome ?? ''),
        status: String(body.status ?? 'draft') as ContentPublicationStatus,
        isActive: checked(body.isActive),
        isRequired: checked(body.isRequired),
      });
      return res.redirect(`/admin/courses/${id}?ok=1`);
    } catch {
      return res.redirect('/admin/courses');
    }
  }

  @Post('courses/:id/modules')
  @UseGuards(AdminSessionGuard)
  async moduleCreate(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    try {
      const slug = String(body.slug ?? '').trim();
      const title = String(body.title ?? '').trim();
      if (!slug || !title) {
        return res.redirect(
          `/admin/courses/${id}?err=${encodeURIComponent('Module slug and title required')}`,
        );
      }
      await this.catalog.createModule({
        courseTemplateId: id,
        slug,
        title,
        orderHint: num(body.orderHint),
        estimatedMinutes: num(body.estimatedMinutes),
        actorId: req.session.adminUserId,
      });
      return res.redirect(`/admin/courses/${id}?ok=module`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Module create failed';
      return res.redirect(
        `/admin/courses/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
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
      flashErr: err ? decodeURIComponent(err) : null,
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
      flashErr: err ? decodeURIComponent(err) : null,
    };
  }

  @Post('roles')
  @UseGuards(AdminSessionGuard)
  async roleCreate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
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
      flashErr: err ? decodeURIComponent(err) : null,
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
        flashErr: err ? decodeURIComponent(err) : null,
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
  async questionnaireRoleDelete(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
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
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
      });
    } catch {
      return res.redirect('/admin/questionnaire');
    }
  }

  @Post('questionnaire/:id/activate')
  @UseGuards(AdminSessionGuard)
  async questionnaireActivate(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      await this.questionnaireAdmin.activate(id);
      return res.redirect(`/admin/questionnaire/${id}?ok=activated`);
    } catch {
      return res.redirect('/admin/questionnaire');
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
        return res.redirect(`/admin/questionnaire/${step.definitionId}/steps/${stepId}`);
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
          isSchedule: step.uiKind === 'schedule',
          isOptions: step.uiKind !== 'schedule',
          selectionSingle: step.selection === 'single',
          selectionMulti: step.selection === 'multi',
        },
        options,
        hasOptions: options.length > 0,
        icons: this.questionnaireAdmin.iconChoices(step.reviewIcon),
        optionIcons: this.questionnaireAdmin.iconChoices(),
        backHref: `/admin/questionnaire/${defId}`,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
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
        },
        icons: this.questionnaireAdmin.iconChoices(opt.icon),
        backHref: `/admin/questionnaire/${defId}/steps/${stepId}`,
        flashOk: ok === 'saved' ? 'Option saved.' : null,
        flashErr: err ? decodeURIComponent(err) : null,
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

  @Get('roadmap-engine')
  @UseGuards(AdminSessionGuard)
  async roadmapEnginePage(
    @Req() req: AdminRequest,
    @Res() res: Response,
  ) {
    const [health, goals, config] = await Promise.all([
      this.roadmapEngineAdmin.checkHealth(),
      this.roadmapEngineAdmin.listRecentGoals(),
      Promise.resolve(this.roadmapEngineAdmin.configSummary()),
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
    const goalId = (body.goalIdManual?.trim() || body.goalId?.trim() || '');
    const [health, goals, config] = await Promise.all([
      this.roadmapEngineAdmin.checkHealth(),
      this.roadmapEngineAdmin.listRecentGoals(),
      Promise.resolve(this.roadmapEngineAdmin.configSummary()),
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
    const phaseTitles = (result.summary?.phaseTitles as
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

  @Get('skill-graph')
  @UseGuards(AdminSessionGuard)
  @Render('skill-graph')
  async skillGraphList(
    @Req() req: AdminRequest,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
    @Query('msg') msg?: string,
  ) {
    const rows = await this.skillGraphAdmin.listStacks();
    const flashMap: Record<string, string> = {
      created: 'Stack created.',
      deleted: 'Stack deleted.',
      imported: msg
        ? decodeURIComponent(msg)
        : 'Catalog JSON imported.',
    };
    return {
      title: 'Skill graph',
      email: req.session.adminEmail ?? '',
      navSkillGraph: true,
      rows,
      hasRows: rows.length > 0,
      count: rows.length,
      countSingular: rows.length === 1,
      flashOk: ok ? (flashMap[ok] ?? null) : null,
      flashErr: err ? decodeURIComponent(err) : null,
    };
  }

  @Post('skill-graph/import')
  @UseGuards(AdminSessionGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async skillGraphImport(
    @UploadedFile()
    file: { buffer: Buffer; originalname?: string; mimetype?: string } | undefined,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      if (!file?.buffer?.length) {
        throw new BadRequestException('Choose a .json catalog file');
      }
      const name = String(file.originalname ?? '').toLowerCase();
      if (name && !name.endsWith('.json')) {
        throw new BadRequestException('File must be .json');
      }
      const stats = await this.skillGraphAdmin.importCatalogJson(file.buffer, {
        overwrite: checked(body.overwrite),
      });
      const summary = [
        `+${stats.stacksAdded}/~${stats.stacksUpdated} stacks`,
        `+${stats.skillsAdded}/~${stats.skillsUpdated} skills`,
        `+${stats.lessonsAdded}/~${stats.lessonsUpdated} lessons`,
        `+${stats.recipesAdded}/~${stats.recipesUpdated} recipes`,
      ].join(', ');
      return res.redirect(
        `/admin/skill-graph?ok=imported&msg=${encodeURIComponent(`Imported: ${summary}`)}`,
      );
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? String(
              (e.getResponse() as { message?: string | string[] }).message ??
                e.message,
            )
          : e instanceof Error
            ? e.message
            : 'Import failed';
      return res.redirect(
        `/admin/skill-graph?err=${encodeURIComponent(Array.isArray(msg) ? msg.join(', ') : msg)}`,
      );
    }
  }

  @Post('skill-graph/stacks')
  @UseGuards(AdminSessionGuard)
  async skillGraphStackCreate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const row = await this.skillGraphAdmin.createStack({
        slug: String(body.slug ?? ''),
        name: String(body.name ?? ''),
        category: String(body.category ?? ''),
        description: String(body.description ?? ''),
      });
      return res.redirect(`/admin/skill-graph/stacks/${row.id}?ok=created`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Create failed';
      return res.redirect(`/admin/skill-graph?err=${encodeURIComponent(msg)}`);
    }
  }

  @Get('skill-graph/stacks/:id')
  @UseGuards(AdminSessionGuard)
  async skillGraphStackDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const { stack, skills } = await this.skillGraphAdmin.getStack(id);
      const flashMap: Record<string, string> = {
        '1': 'Stack saved.',
        created: 'Stack created.',
        skill: 'Skill created.',
        'skill-deleted': 'Skill deleted.',
      };
      return res.render('skill-graph-stack', {
        title: stack.name,
        email: req.session.adminEmail ?? '',
        navSkillGraph: true,
        stack,
        skills,
        hasSkills: skills.length > 0,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
      });
    } catch {
      return res.redirect('/admin/skill-graph');
    }
  }

  @Post('skill-graph/stacks/:id')
  @UseGuards(AdminSessionGuard)
  async skillGraphStackSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.skillGraphAdmin.updateStack(id, {
        name: String(body.name ?? ''),
        category: String(body.category ?? ''),
        description: String(body.description ?? ''),
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/skill-graph/stacks/${id}?ok=1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/skill-graph/stacks/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('skill-graph/stacks/:id/delete')
  @UseGuards(AdminSessionGuard)
  async skillGraphStackDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      await this.skillGraphAdmin.deleteStack(id);
      return res.redirect('/admin/skill-graph?ok=deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(`/admin/skill-graph?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('skill-graph/stacks/:id/skills')
  @UseGuards(AdminSessionGuard)
  async skillGraphSkillCreate(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const skill = await this.skillGraphAdmin.createSkill(id, {
        slug: String(body.slug ?? ''),
        title: String(body.title ?? ''),
        description: String(body.description ?? ''),
        orderHint: num(body.orderHint),
        estimatedHours: num(body.estimatedHours, 1),
        tags: String(body.tags ?? ''),
        prereqSlugs: String(body.prereqSlugs ?? ''),
      });
      return res.redirect(`/admin/skill-graph/skills/${skill.id}?ok=created`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Skill create failed';
      return res.redirect(
        `/admin/skill-graph/stacks/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('skill-graph/skills/:id')
  @UseGuards(AdminSessionGuard)
  async skillGraphSkillDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const data = await this.skillGraphAdmin.getSkill(id);
      const flashMap: Record<string, string> = {
        '1': 'Skill saved.',
        created: 'Skill created.',
        lesson: 'Lesson created.',
        'lesson-deleted': 'Lesson deleted.',
      };
      return res.render('skill-graph-skill', {
        title: data.skill.title,
        email: req.session.adminEmail ?? '',
        navSkillGraph: true,
        ...data,
        hasLessons: data.lessons.length > 0,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
        lessonTypes: this.skillGraphAdmin.lessonTypeChoices('reading'),
      });
    } catch {
      return res.redirect('/admin/skill-graph');
    }
  }

  @Post('skill-graph/skills/:id')
  @UseGuards(AdminSessionGuard)
  async skillGraphSkillSave(
    @Param('id') id: string,
    @Body() body: Record<string, string | string[]>,
    @Res() res: Response,
  ) {
    try {
      const rawPrereq = body.prereqIds;
      const prereqIds = Array.isArray(rawPrereq)
        ? rawPrereq.map(String)
        : rawPrereq
          ? [String(rawPrereq)]
          : [];
      await this.skillGraphAdmin.updateSkill(id, {
        title: String(body.title ?? ''),
        description: String(body.description ?? ''),
        orderHint: num(body.orderHint),
        estimatedHours: num(body.estimatedHours, 1),
        tags: String(body.tags ?? ''),
        prereqIds,
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/skill-graph/skills/${id}?ok=1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/skill-graph/skills/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('skill-graph/skills/:id/delete')
  @UseGuards(AdminSessionGuard)
  async skillGraphSkillDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      const { stackId } = await this.skillGraphAdmin.deleteSkill(id);
      return res.redirect(
        `/admin/skill-graph/stacks/${stackId}?ok=skill-deleted`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(`/admin/skill-graph?err=${encodeURIComponent(msg)}`);
    }
  }

  @Post('skill-graph/skills/:id/lessons')
  @UseGuards(AdminSessionGuard)
  async skillGraphLessonCreate(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      const lesson = await this.skillGraphAdmin.createLesson(id, {
        slug: String(body.slug ?? ''),
        title: String(body.title ?? ''),
        lessonType: String(body.lessonType ?? 'reading'),
        estimatedMinutes: num(body.estimatedMinutes, 20),
        xpReward: num(body.xpReward, 20),
        orderHint: num(body.orderHint),
        missionNameTemplate: String(body.missionNameTemplate ?? ''),
        learningStyleTags: String(body.learningStyleTags ?? ''),
      });
      return res.redirect(`/admin/skill-graph/lessons/${lesson.id}?ok=created`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Lesson create failed';
      return res.redirect(
        `/admin/skill-graph/skills/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Get('skill-graph/lessons/:id')
  @UseGuards(AdminSessionGuard)
  async skillGraphLessonDetail(
    @Param('id') id: string,
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('ok') ok?: string,
    @Query('err') err?: string,
  ) {
    try {
      const data = await this.skillGraphAdmin.getLesson(id);
      const flashMap: Record<string, string> = {
        '1': 'Lesson saved.',
        created: 'Lesson created.',
      };
      return res.render('skill-graph-lesson', {
        title: data.lesson.title,
        email: req.session.adminEmail ?? '',
        navSkillGraph: true,
        ...data,
        flashOk: ok ? (flashMap[ok] ?? null) : null,
        flashErr: err ? decodeURIComponent(err) : null,
      });
    } catch {
      return res.redirect('/admin/skill-graph');
    }
  }

  @Post('skill-graph/lessons/:id')
  @UseGuards(AdminSessionGuard)
  async skillGraphLessonSave(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    try {
      await this.skillGraphAdmin.updateLesson(id, {
        title: String(body.title ?? ''),
        lessonType: String(body.lessonType ?? 'reading'),
        estimatedMinutes: num(body.estimatedMinutes, 20),
        xpReward: num(body.xpReward, 20),
        orderHint: num(body.orderHint),
        missionNameTemplate: String(body.missionNameTemplate ?? ''),
        learningStyleTags: String(body.learningStyleTags ?? ''),
        contentOutlineJson: String(body.contentOutlineJson ?? ''),
        isActive: checked(body.isActive),
      });
      return res.redirect(`/admin/skill-graph/lessons/${id}?ok=1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      return res.redirect(
        `/admin/skill-graph/lessons/${id}?err=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('skill-graph/lessons/:id/delete')
  @UseGuards(AdminSessionGuard)
  async skillGraphLessonDelete(@Param('id') id: string, @Res() res: Response) {
    try {
      const { skillId } = await this.skillGraphAdmin.deleteLesson(id);
      return res.redirect(
        `/admin/skill-graph/skills/${skillId}?ok=lesson-deleted`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      return res.redirect(`/admin/skill-graph?err=${encodeURIComponent(msg)}`);
    }
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
