import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  Notification,
  NotificationChannel,
  NotificationType,
} from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

type RepoMock<T> = {
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function repoMock<T>(): RepoMock<T> {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x) => x),
    count: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationsRepo: RepoMock<Notification>;
  let preferencesRepo: RepoMock<NotificationPreference>;

  const prefs = (overrides: Partial<NotificationPreference> = {}) =>
    ({
      id: 'pref-1',
      userId: 'user-1',
      pushEnabled: true,
      emailDigestsEnabled: true,
      streakRemindersEnabled: true,
      battleInvitesEnabled: true,
      productUpdatesEnabled: false,
      ...overrides,
    }) as NotificationPreference;

  beforeEach(async () => {
    notificationsRepo = repoMock();
    preferencesRepo = repoMock();

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
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('create', () => {
    it('persists in-app streak reminder when prefs allow', async () => {
      preferencesRepo.findOne.mockResolvedValue(prefs());
      notificationsRepo.save.mockImplementation(async (row) => ({
        ...row,
        id: 'n-1',
        createdAt: new Date('2026-07-12T12:00:00Z'),
        readAt: null,
      }));

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
      notificationsRepo.save.mockImplementation(async (row) => ({
        ...row,
        id: 'n-2',
        createdAt: new Date(),
        readAt: null,
      }));

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
  });

  describe('updatePreferences', () => {
    it('patches only provided toggles', async () => {
      preferencesRepo.findOne.mockResolvedValue(prefs());
      preferencesRepo.save.mockImplementation(async (row) => row);

      const result = await service.updatePreferences('user-1', {
        marketing: true,
        push: false,
      });

      expect(result.preferences).toEqual({
        push: false,
        email: true,
        streakReminders: true,
        battleInvites: true,
        marketing: true,
      });
      expect(result.toggles).toHaveLength(5);
    });
  });
});
