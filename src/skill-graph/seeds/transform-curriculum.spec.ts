import { LessonContentService } from '../../lessons/lesson-content.service';
import {
  assertConceptTagsPresent,
  collectSecretKeyHits,
  isPlayOutline,
} from '../../lessons/lesson-play.types';
import {
  transformCurriculumLesson,
  validateTransformedOutline,
} from './transform-curriculum';

const SAMPLE_QUIZ_LESSON = {
  skillSlug: 'web-internet',
  lessonSlug: 'web-internet-quiz',
  title: 'Request/response check',
  lessonType: 'quiz',
  content: {
    format: 'quiz' as const,
    objective: 'Verify you can explain the request/response cycle.',
    questions: [
      {
        prompt: 'What does DNS do?',
        options: [
          'Encrypts traffic between client and server',
          'Converts domain names into IP addresses',
          'Stores cookies for websites',
          'Compresses images before download',
        ],
        correctIndex: 1,
        explanation:
          'DNS maps human-friendly names like example.com to numeric IP addresses.',
      },
      {
        prompt: 'Your browser receives a 404 status code. What does it mean?',
        options: [
          'The server crashed',
          'The request succeeded',
          'The requested resource was not found',
          'You are not authorized',
        ],
        correctIndex: 2,
        explanation:
          '4xx codes are client-side errors; 404 means the resource does not exist.',
      },
    ],
  },
};

describe('transformCurriculumLesson', () => {
  it('transforms quiz lesson into valid play outline with concept tags + remediation', () => {
    const outline = transformCurriculumLesson(SAMPLE_QUIZ_LESSON);
    expect(isPlayOutline(outline)).toBe(true);
    expect(() => validateTransformedOutline(outline)).not.toThrow();
    expect(() => assertConceptTagsPresent(outline)).not.toThrow();

    expect(outline.practice.conceptTag).toMatch(/^web-internet:/);
    expect(outline.practice.prompt).toContain('DNS');
    expect(outline.quiz).toHaveLength(1);
    expect(outline.quiz[0].conceptTag).toMatch(/^web-internet:/);
    expect(outline.quiz[0].correctOptionId).toBeTruthy();
    expect(outline.rewardPresentation?.rewardClass).toBe('knowledge_check');

    const tags = [
      outline.practice.conceptTag,
      ...outline.quiz.map((q) => q.conceptTag),
    ];
    for (const tag of tags) {
      const pool = outline.remediation?.[tag];
      expect(pool).toBeDefined();
      expect(pool!.recoveryItems.length).toBeGreaterThanOrEqual(1);
      expect(pool!.recoveryItems[0].prompt).not.toBe(outline.practice.prompt);
      if (outline.quiz[0]?.conceptTag === tag) {
        expect(pool!.recoveryItems[0].prompt).not.toBe(outline.quiz[0].prompt);
      }
    }
  });

  it('fails seed validation when conceptTag stripped', () => {
    const outline = transformCurriculumLesson(SAMPLE_QUIZ_LESSON);
    const broken = {
      ...outline,
      practice: { ...outline.practice, conceptTag: '' },
    };
    expect(() => assertConceptTagsPresent(broken)).toThrow(/conceptTag/);
  });

  it('public strip removes every secret key', () => {
    const outline = transformCurriculumLesson(SAMPLE_QUIZ_LESSON);
    const content = new LessonContentService();
    const publicBody = content.toPublicPlayBody(outline);
    const hits = collectSecretKeyHits(publicBody);
    expect(hits).toEqual([]);
    expect(publicBody).not.toHaveProperty('remediation');
    expect(JSON.stringify(publicBody)).not.toContain('correctOptionId');
    expect(JSON.stringify(publicBody)).not.toContain('feedbackIncorrect');
    expect(JSON.stringify(publicBody)).not.toContain('badgeCandidateKey');
  });
});
