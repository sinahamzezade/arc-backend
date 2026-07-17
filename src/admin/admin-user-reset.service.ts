import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Profile,
  QuestionnaireStatus,
} from '../profiles/entities/profile.entity';
import { RoadmapCacheService } from '../roadmaps/roadmap-cache.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AdminUserResetService {
  private readonly logger = new Logger(AdminUserResetService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
    private readonly dataSource: DataSource,
    private readonly roadmapCache: RoadmapCacheService,
  ) {}

  /**
   * Wipe this user's roadmap path + questionnaire so they can start Q again.
   * Keeps account, XP/coins/gems, badges.
   * Also clears learner profile snapshots (otherwise GET /questionnaire still
   * returns an active profile) and revokes refresh tokens so the JWT-cached
   * `questionnaireStatus: completed` cannot keep them on /home.
   */
  async resetQuestionnaireAndRoadmap(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Capture ids before wipe so we can bust tree cache (TTL otherwise ghosts Path).
    const roadmapIds: string[] = (
      await this.dataSource.query(
        `SELECT id FROM roadmaps WHERE user_id = $1`,
        [userId],
      )
    ).map((r: { id: string }) => r.id);
    const cachedActiveId =
      await this.roadmapCache.getActiveRoadmapId(userId);

    await this.dataSource.transaction(async (manager) => {
      // Lesson play state
      await manager.query(
        `DELETE FROM lesson_completion_results WHERE user_id = $1`,
        [userId],
      );
      await manager.query(`DELETE FROM remediation_events WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(`DELETE FROM lesson_attempts WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(`DELETE FROM lesson_progress WHERE user_id = $1`, [
        userId,
      ]);

      // Weeks
      await manager.query(
        `DELETE FROM weekly_plan_events WHERE user_id = $1`,
        [userId],
      );
      await manager.query(
        `DELETE FROM weekly_tasks
         WHERE weekly_plan_id IN (SELECT id FROM weekly_plans WHERE user_id = $1)`,
        [userId],
      );
      await manager.query(`DELETE FROM weekly_plans WHERE user_id = $1`, [
        userId,
      ]);

      // Course timing
      await manager.query(`DELETE FROM reminder_plans WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(`DELETE FROM schedule_changes WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(`DELETE FROM schedule_slots WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(`DELETE FROM pace_snapshots WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(`DELETE FROM course_schedules WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(
        `DELETE FROM learning_commitments WHERE user_id = $1`,
        [userId],
      );

      // Engagement extras tied to path
      await manager.query(`DELETE FROM cross_track_nudges WHERE user_id = $1`, [
        userId,
      ]);
      await manager.query(
        `DELETE FROM coach_relationship_state WHERE user_id = $1`,
        [userId],
      );
      await manager.query(
        `DELETE FROM roadmap_completion_events WHERE user_id = $1`,
        [userId],
      );
      await manager.query(
        `DELETE FROM re_enrollment_jobs WHERE user_id = $1`,
        [userId],
      );

      // Roadmap generation + tree (phases/milestones/lessons cascade via FK)
      await manager.query(
        `DELETE FROM roadmap_generation_jobs WHERE user_id = $1`,
        [userId],
      );
      // Explicit child wipe — some envs lack ON DELETE CASCADE on all FKs
      await manager.query(
        `DELETE FROM lessons
         WHERE milestone_id IN (
           SELECT m.id FROM milestones m
           INNER JOIN roadmap_phases p ON p.id = m.phase_id
           INNER JOIN roadmaps r ON r.id = p.roadmap_id
           WHERE r.user_id = $1
         )`,
        [userId],
      );
      await manager.query(
        `DELETE FROM milestones
         WHERE phase_id IN (
           SELECT p.id FROM roadmap_phases p
           INNER JOIN roadmaps r ON r.id = p.roadmap_id
           WHERE r.user_id = $1
         )`,
        [userId],
      );
      await manager.query(
        `DELETE FROM roadmap_phases
         WHERE roadmap_id IN (SELECT id FROM roadmaps WHERE user_id = $1)`,
        [userId],
      );
      await manager.query(`DELETE FROM roadmaps WHERE user_id = $1`, [userId]);

      // Learner profiling — must go or getActiveProfile() still returns old track
      // (skill estimates CASCADE from snapshots)
      await manager.query(
        `DELETE FROM learner_profile_snapshots WHERE user_id = $1`,
        [userId],
      );

      // Questionnaire + goals (response holds goal_id FK)
      await manager.query(
        `DELETE FROM questionnaire_responses WHERE user_id = $1`,
        [userId],
      );
      await manager.query(`DELETE FROM goals WHERE user_id = $1`, [userId]);

      // Force re-login so Auth.js JWT drops cached questionnaireStatus=completed
      await manager.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [
        userId,
      ]);

      await manager.getRepository(Profile).update(
        { userId },
        {
          questionnaireStatus: QuestionnaireStatus.NotStarted,
          questionnaireCompletedAt: null,
          onboardingCompletedAt: null,
          intakeMode: null,
        },
      );
    });

    // Bust in-memory/Redis tree cache — DB wipe alone leaves ghost Path in admin/app.
    const idsToBust = new Set(
      [...roadmapIds, cachedActiveId].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    );
    for (const roadmapId of idsToBust) {
      await this.roadmapCache.invalidateRoadmap(roadmapId, userId);
    }
    await this.roadmapCache.invalidateUser(userId);

    this.logger.warn(
      `Admin reset questionnaire+roadmap for user=${userId} (${user.email}) cacheBusted=${idsToBust.size}`,
    );

    const profile = await this.profiles.findOne({ where: { userId } });
    return {
      userId,
      email: user.email,
      questionnaireStatus:
        profile?.questionnaireStatus ?? QuestionnaireStatus.NotStarted,
    };
  }
}
