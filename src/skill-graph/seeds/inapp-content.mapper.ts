import type { LessonPlayOutline } from '../../lessons/lesson-play.types';
import { buildDefaultPlayOutline } from '../../lessons/play-outline.factory';

type InAppCode = { language?: string; snippet?: string };

type InAppReading = {
  format: 'reading';
  objective: string;
  sections?: Array<{ heading: string; body: string; code?: InAppCode }>;
  keyTakeaways?: string[];
};

type InAppQuiz = {
  format: 'quiz';
  objective: string;
  questions?: Array<{
    prompt: string;
    options: string[];
    correctIndex: number;
    explanation?: string;
  }>;
};

type InAppPractice = {
  format: 'practice';
  objective: string;
  instructions?: string[];
  starterCode?: InAppCode;
  solutionCode?: InAppCode;
  hints?: string[];
};

type InAppMiniProject = {
  format: 'mini_project';
  objective: string;
  brief?: string;
  requirements?: string[];
  steps?: string[];
  rubric?: string[];
  reward?: { gems?: number; coins?: number; arloLine?: string };
};

type InAppReflection = {
  format: 'reflection';
  objective: string;
  prompts?: string[];
};

export type InAppLessonContent =
  | InAppReading
  | InAppQuiz
  | InAppPractice
  | InAppMiniProject
  | InAppReflection
  | Record<string, unknown>;

const OPT_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

function letterId(i: number): string {
  return OPT_IDS[i] ?? `o${i}`;
}

function stubPractice(prompt: string, hint: string): LessonPlayOutline['practice'] {
  return {
    id: 'p1',
    prompt,
    hint,
    options: [
      { id: 'a', label: 'I completed this step', correct: true },
      { id: 'b', label: 'Skip — I already know this', correct: false },
      { id: 'c', label: 'Come back later', correct: false },
    ],
    feedbackCorrect: 'Nice — keep moving.',
    feedbackIncorrect: 'Mark complete when you finish the step.',
  };
}

function stubQuiz(objective: string): LessonPlayOutline['quiz'] {
  return [
    {
      id: 'q1',
      prompt: 'What is the main goal of this lesson?',
      options: [
        { id: 'a', label: objective.slice(0, 120) || 'Learn the core idea' },
        { id: 'b', label: 'Skip learning entirely' },
        { id: 'c', label: 'Memorize unrelated trivia' },
      ],
      correctOptionId: 'a',
      explanation: 'Stay focused on the lesson objective.',
    },
  ];
}

function fromReading(c: InAppReading, title: string): LessonPlayOutline {
  const pages =
    (c.sections ?? []).map((sec, i) => {
      const blocks: LessonPlayOutline['content'][0]['blocks'] = [
        { type: 'text', body: sec.body },
      ];
      if (sec.code?.snippet) {
        blocks.push({
          type: 'code',
          label: sec.code.language || 'code',
          code: sec.code.snippet,
        });
      }
      return {
        id: `c${i + 1}`,
        title: sec.heading || `Section ${i + 1}`,
        blocks,
      };
    }) ?? [];

  if (c.keyTakeaways?.length) {
    pages.push({
      id: `c${pages.length + 1}`,
      title: 'Key takeaways',
      blocks: [
        {
          type: 'callout',
          title: 'Remember',
          body: c.keyTakeaways.map((t) => `• ${t}`).join('\n'),
        },
      ],
    });
  }

  if (!pages.length) {
    pages.push({
      id: 'c1',
      title: title,
      blocks: [{ type: 'text', body: c.objective }],
    });
  }

  return {
    objective: c.objective,
    arloPrompt: `Stuck on “${title}”? Ask me to break it down.`,
    suggestedArlo: [
      `Explain “${title}” simply`,
      'Give me a 60-second recap',
      'Quiz me on the key idea',
    ],
    content: pages,
    practice: stubPractice(
      `Ready to lock in “${title}”?`,
      c.keyTakeaways?.[0] ?? 'Skim the sections once more, then continue.',
    ),
    quiz: stubQuiz(c.objective),
    reward: {
      gems: 2,
      coins: 10,
      arloLine: `Solid — “${title}” is on the map.`,
    },
  };
}

function fromQuiz(c: InAppQuiz, title: string): LessonPlayOutline {
  const quiz = (c.questions ?? []).map((q, i) => ({
    id: `q${i + 1}`,
    prompt: q.prompt,
    options: q.options.map((label, oi) => ({
      id: letterId(oi),
      label,
    })),
    correctOptionId: letterId(q.correctIndex),
    explanation: q.explanation ?? 'Check the lesson notes and try again.',
  }));

  return {
    objective: c.objective,
    arloPrompt: `Need a hint on “${title}”? Ask away.`,
    suggestedArlo: ['Explain the trickiest question', 'Give me a memory trick'],
    content: [
      {
        id: 'c1',
        title: 'Quick check',
        blocks: [
          {
            type: 'text',
            body: c.objective,
          },
          {
            type: 'callout',
            title: 'Arlo says',
            body: 'Read each option. Eliminate the nonsense. Trust the definition.',
          },
        ],
      },
    ],
    practice: stubPractice(
      'Warm-up: are you ready for the quiz?',
      'Skim the objective, then answer each question.',
    ),
    quiz: quiz.length ? quiz : stubQuiz(c.objective),
    reward: {
      gems: 3,
      coins: 12,
      arloLine: `Quiz cleared — “${title}” sticks.`,
    },
  };
}

function fromPractice(c: InAppPractice, title: string): LessonPlayOutline {
  const blocks: LessonPlayOutline['content'][0]['blocks'] = [
    { type: 'text', body: c.objective },
  ];
  for (const [i, step] of (c.instructions ?? []).entries()) {
    blocks.push({ type: 'text', body: `${i + 1}. ${step}` });
  }
  if (c.starterCode?.snippet) {
    blocks.push({
      type: 'code',
      label: c.starterCode.language || 'starter',
      code: c.starterCode.snippet,
    });
  }
  if (c.solutionCode?.snippet) {
    blocks.push({
      type: 'callout',
      title: 'Solution notes',
      body: 'Compare after you try — spoilers ahead.',
    });
    blocks.push({
      type: 'code',
      label: c.solutionCode.language || 'solution',
      code: c.solutionCode.snippet,
    });
  }

  const hint = c.hints?.[0] ?? 'Follow the instructions in order.';

  return {
    objective: c.objective,
    arloPrompt: `Stuck practicing “${title}”? Show me where you are.`,
    suggestedArlo: ['Hint for step 1', 'Am I doing this right?', 'Explain the solution'],
    content: [
      {
        id: 'c1',
        title: 'Practice steps',
        blocks,
      },
    ],
    practice: {
      id: 'p1',
      prompt: `Did you finish the practice for “${title}”?`,
      hint,
      options: [
        { id: 'a', label: 'Yes — I completed the steps', correct: true },
        { id: 'b', label: 'I only read the instructions', correct: false },
        { id: 'c', label: 'I skipped the practice', correct: false },
      ],
      feedbackCorrect: 'Hands-on win.',
      feedbackIncorrect: 'Run the steps once — muscle memory beats skimming.',
    },
    quiz: stubQuiz(c.objective),
    reward: {
      gems: 3,
      coins: 15,
      arloLine: `Practice done — “${title}” unlocked.`,
    },
  };
}

function fromMiniProject(c: InAppMiniProject, title: string): LessonPlayOutline {
  const blocks: LessonPlayOutline['content'][0]['blocks'] = [];
  if (c.brief) blocks.push({ type: 'text', body: c.brief });
  if (c.requirements?.length) {
    blocks.push({
      type: 'callout',
      title: 'Requirements',
      body: c.requirements.map((r) => `• ${r}`).join('\n'),
    });
  }
  if (c.steps?.length) {
    blocks.push({
      type: 'text',
      body: c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    });
  }
  if (c.rubric?.length) {
    blocks.push({
      type: 'callout',
      title: 'Rubric',
      body: c.rubric.map((r) => `• ${r}`).join('\n'),
    });
  }
  if (!blocks.length) {
    blocks.push({ type: 'text', body: c.objective });
  }

  return {
    objective: c.objective,
    arloPrompt: `Building “${title}”? Ask for a next step.`,
    suggestedArlo: ['Break the brief into steps', 'Review my approach', 'What does the rubric care about?'],
    content: [{ id: 'c1', title: 'Project brief', blocks }],
    practice: stubPractice(
      `Ship the mini project “${title}”?`,
      c.rubric?.[0] ?? 'Hit the requirements, then mark complete.',
    ),
    quiz: stubQuiz(c.objective),
    reward: {
      gems: c.reward?.gems ?? 5,
      coins: c.reward?.coins ?? 25,
      arloLine:
        c.reward?.arloLine ?? `Project shipped — “${title}” looks sharp.`,
    },
  };
}

function fromReflection(c: InAppReflection, title: string): LessonPlayOutline {
  const body = (c.prompts ?? [])
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n\n');

  return {
    objective: c.objective,
    arloPrompt: `Reflecting on “${title}”? Talk it through with me.`,
    suggestedArlo: ['Help me answer prompt 1', 'What should I notice here?'],
    content: [
      {
        id: 'c1',
        title: 'Reflection prompts',
        blocks: [
          { type: 'text', body: c.objective },
          {
            type: 'callout',
            title: 'Write / say out loud',
            body: body || 'What did you learn?',
          },
        ],
      },
    ],
    practice: stubPractice(
      'Did you answer the reflection prompts?',
      'Honest notes beat perfect prose.',
    ),
    quiz: stubQuiz(c.objective),
    reward: {
      gems: 2,
      coins: 10,
      arloLine: `Reflection logged — “${title}” sinks in.`,
    },
  };
}

/** Map course JSON `lessons[].content` → Nest `LessonPlayOutline`. */
export function inappContentToPlayOutline(input: {
  title: string;
  missionNameTemplate?: string | null;
  lessonType: string;
  content?: InAppLessonContent | null;
}): LessonPlayOutline {
  const content = input.content;
  const format =
    content && typeof content === 'object' && 'format' in content
      ? String((content as { format?: string }).format)
      : input.lessonType;

  if (!content || typeof content !== 'object') {
    return buildDefaultPlayOutline({
      title: input.title,
      missionName: input.missionNameTemplate,
      lessonType: input.lessonType,
    });
  }

  switch (format) {
    case 'reading':
      return fromReading(content as InAppReading, input.title);
    case 'quiz':
      return fromQuiz(content as InAppQuiz, input.title);
    case 'practice':
      return fromPractice(content as InAppPractice, input.title);
    case 'mini_project':
      return fromMiniProject(content as InAppMiniProject, input.title);
    case 'reflection':
      return fromReflection(content as InAppReflection, input.title);
    default:
      return buildDefaultPlayOutline({
        title: input.title,
        missionName: input.missionNameTemplate,
        lessonType: input.lessonType,
      });
  }
}
