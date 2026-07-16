import { RoadmapCacheService } from './roadmap-cache.service';
import { RoadmapTreeLoader } from './roadmap-tree.loader';
import { Roadmap, RoadmapStatus } from './entities/roadmap.entity';

describe('RoadmapTreeLoader cache', () => {
  it('returns cached tree without hydrating from the database', async () => {
    const cachedTree = {
      id: 'roadmap-1',
      title: 'Cached roadmap',
      primaryRoleSlug: 'backend',
      timelineWeeks: 8,
      progressPercent: 10,
      currentPhaseId: null,
      status: RoadmapStatus.Ready,
      phases: [],
    };

    const roadmapCache = {
      getActiveRoadmapId: jest.fn().mockResolvedValue('roadmap-1'),
      getTree: jest.fn().mockResolvedValue(cachedTree),
      setTree: jest.fn(),
      setOrdinals: jest.fn(),
      setActiveRoadmapId: jest.fn(),
    } as unknown as RoadmapCacheService;

    const roadmapsRepo = {
      findOne: jest.fn(),
    };
    const phasesRepo = { find: jest.fn() };
    const milestonesRepo = { find: jest.fn() };
    const lessonsRepo = { createQueryBuilder: jest.fn() };

    const loader = new RoadmapTreeLoader(
      roadmapsRepo as never,
      phasesRepo as never,
      milestonesRepo as never,
      lessonsRepo as never,
      roadmapCache,
    );

    const roadmap = await loader.loadActiveRoadmap('user-1');
    expect(roadmap?.id).toBe('roadmap-1');
    expect(roadmapsRepo.findOne).not.toHaveBeenCalled();
    expect(phasesRepo.find).not.toHaveBeenCalled();
  });
});
