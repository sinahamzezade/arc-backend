import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationSchedule } from './entities/notification-schedule.entity';
import {
  Notification,
  NotificationChannel,
  NotificationType,
} from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import { NotificationsService } from './notifications.service';

type RepoMock = {
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function repoMock(): RepoMock {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x) => x),
    count: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    })),
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationsRepo: RepoMock;
  let preferencesRepo: RepoMock;
  let deliveriesRepo: RepoMock;
  let schedulesRepo: RepoMock;

  const prefs = (overrides: Partial<NotificationPreference> = {}) =>
    ({
      id: 'pref-1',
      userId: 'user-1',
      inAppEnabled: true,
      pushEnabled: true,
      emailDigestsEnabled: true,
      learningRemindersEnabled: true,
      weeklyProgressEnabled: true,
      streakRemindersEnabled: true,
      rewardsEnabled: true,
      socialEnabled: true,
      studyTogetherInvitesEnabled: true,
      battleInvitesEnabled: true,
      leagueUpdatesEnabled: true,
      luckyWheelEnabled: true,
      coachMessagesEnabled: true,
      productUpdatesEnabled: false,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timezoneSnapshot: 'UTC',
      ...overrides,
    }) as NotificationPreference;

  beforeEach(async () => {
    notificationsRepo = repoMock();
    preferencesRepo = repoMock();
    deliveriesRepo = repoMock();
    schedulesRepo = repoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationsRepo,
        },
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: preferencesRepo,
        },
        {
          provide: getRepositoryToken(PushDevice),
          useValue: repoMock(),
        },
        {
          provide: getRepositoryToken(NotificationSchedule),
          useValue: schedulesRepo,
        },
        {
          provide: getRepositoryToken(NotificationDelivery),
          useValue: deliveriesRepo,
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('create', () => {
    it('persists in-app streak reminder when prefs allow', async () => {
      preferencesRepo.findOne.mockResolvedValue(prefs());
      notificationsRepo.findOne.mockResolvedValue(null);
      notificationsRepo.save.mockImplementation(async (row) => ({
        ...row,
        id: 'n-1',
        createdAt: new Date('2026-07-12T12:00:00Z'),
        readAt: null,
      }));
      deliveriesRepo.save.mockImplementation(async (row) => row);

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.StreakRisk,
        title: 'Streak reminder',
        body: 'Finish one lesson today.',
        channels: [NotificationChannel.InApp, NotificationChannel.Push],
      });

      expect(result).toMatchObject({
        id: 'n-1',
        type: NotificationType.StreakRisk,
        category: 'streak',
      });
      expect(notificationsRepo.save).toHaveBeenCalled();
    });

    it('skips streak reminder when streakReminders disabled', async () => {
      preferencesRepo.findOne.mockResolvedValue(
        prefs({ streakRemindersEnabled: false }),
      );

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.StreakRisk,
        title: 'Streak reminder',
        body: 'Finish one lesson today.',
      });

      expect(result).toBeNull();
      expect(notificationsRepo.save).not.toHaveBeenCalled();
    });

    it('skips product update when marketing disabled', async () => {
      preferencesRepo.findOne.mockResolvedValue(
        prefs({ productUpdatesEnabled: false }),
      );

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.ProductUpdate,
        title: 'New feature',
        body: 'Tips inside.',
      });

      expect(result).toBeNull();
    });

    it('creates product update when marketing enabled', async () => {
      preferencesRepo.findOne.mockResolvedValue(
        prefs({ productUpdatesEnabled: true }),
      );
      notificationsRepo.findOne.mockResolvedValue(null);
      notificationsRepo.save.mockImplementation(async (row) => ({
        ...row,
        id: 'n-2',
        createdAt: new Date(),
        readAt: null,
      }));
      deliveriesRepo.save.mockImplementation(async (row) => row);

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.ProductUpdate,
        title: 'New feature',
        body: 'Tips inside.',
      });

      expect(result?.id).toBe('n-2');
    });

    it('skips battle invite when battleInvites disabled', async () => {
      preferencesRepo.findOne.mockResolvedValue(
        prefs({ battleInvitesEnabled: false }),
      );

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.BattleInvite,
        title: 'Battle invite',
        body: 'Sara challenged you.',
      });

      expect(result).toBeNull();
    });

    it('returns existing on dedupe key', async () => {
      preferencesRepo.findOne.mockResolvedValue(prefs());
      notificationsRepo.findOne.mockResolvedValue({
        id: 'existing',
        dedupeKey: 'battle_invite:b1',
      });

      const result = await service.create({
        userId: 'user-1',
        type: NotificationType.BattleInvite,
        title: 'Battle',
        body: 'Go',
        dedupeKey: 'battle_invite:b1',
      });

      expect(result?.id).toBe('existing');
      expect(notificationsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updatePreferences', () => {
    it('patches only provided toggles', async () => {
      preferencesRepo.findOne.mockResolvedValue(prefs());
      preferencesRepo.save.mockImplementation(async (row) => row);

      const result = await service.updatePreferences('user-1', {
        marketing: true,
        push: false,
      });

      expect(result.preferences.push).toBe(false);
      expect(result.preferences.marketing).toBe(true);
      expect(result.preferences.streakReminders).toBe(true);
      expect(result.toggles.length).toBeGreaterThanOrEqual(5);
    });
  });
});
