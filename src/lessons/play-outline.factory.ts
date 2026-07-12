import type { LessonPlayOutline } from './lesson-play.types';

/** Golden fixture matching arc-app lesson-1 mock. */
export const HTML_HELLO_WORLD_OUTLINE: LessonPlayOutline = {
  objective:
    'Build a tiny HTML page with a title, heading, and paragraph — then explain what each tag does.',
  arloPrompt: 'Stuck on tags? Ask me — I live for dramatic HTML moments.',
  suggestedArlo: [
    'Explain <head> vs <body> like I\'m five',
    'Why do I need </p>?',
    'Quiz me on h1 vs p',
  ],
  content: [
    {
      id: 'c1',
      title: 'HTML is the skeleton',
      blocks: [
        {
          type: 'text',
          body: 'A webpage is just a structured document. HTML tags tell the browser what each piece means — heading, paragraph, link, image.',
        },
        {
          type: 'callout',
          title: 'Arlo says',
          body: 'Think LEGO instructions, not poetry. Clear tags beat fancy fluff.',
        },
      ],
    },
    {
      id: 'c2',
      title: 'The holy trinity',
      blocks: [
        {
          type: 'text',
          body: 'Almost every page starts with three containers: html, head, and body. Head holds metadata. Body holds what humans see.',
        },
        {
          type: 'code',
          label: 'starter.html',
          code: `<!DOCTYPE html>
<html>
  <head>
    <title>My first page</title>
  </head>
  <body>
    <h1>Hello, Arc</h1>
    <p>I am learning HTML.</p>
  </body>
</html>`,
        },
      ],
    },
    {
      id: 'c3',
      title: 'Tags you will use today',
      blocks: [
        {
          type: 'text',
          body: 'h1 = main heading. p = paragraph. title = tab name in the browser. Closing tags end with a slash: </p>.',
        },
        {
          type: 'callout',
          title: 'Mission tip',
          body: 'One h1 per page for now. Save nested drama for later lessons.',
        },
      ],
    },
  ],
  practice: {
    id: 'p1',
    prompt: 'Which snippet correctly opens a paragraph and closes it?',
    hint: 'Opening tag, text, closing tag with a slash.',
    options: [
      { id: 'a', label: '<p>Hello Arc</p>', correct: true },
      { id: 'b', label: '<p>Hello Arc<p>', correct: false },
      { id: 'c', label: '</p>Hello Arc<p>', correct: false },
      { id: 'd', label: 'p: Hello Arc', correct: false },
    ],
    feedbackCorrect: 'Nailed it — tags closed clean.',
    feedbackIncorrect:
      'Close! Opening + text + closing slash is the move.',
  },
  quiz: [
    {
      id: 'q1',
      prompt: 'Where does visible page content live?',
      options: [
        { id: 'a', label: '<head>' },
        { id: 'b', label: '<body>' },
        { id: 'c', label: '<title>' },
        { id: 'd', label: '<meta>' },
      ],
      correctOptionId: 'b',
      explanation: 'Body is the stage. Head is backstage metadata.',
    },
    {
      id: 'q2',
      prompt: 'What does <h1> represent?',
      options: [
        { id: 'a', label: 'A hyperlink' },
        { id: 'b', label: 'The main heading' },
        { id: 'c', label: 'A horizontal rule' },
        { id: 'd', label: 'A comment' },
      ],
      correctOptionId: 'b',
      explanation: 'h1 is the top-level heading — your page’s headline.',
    },
    {
      id: 'q3',
      prompt: 'Which title tag is valid?',
      options: [
        { id: 'a', label: '<title>My page<title>' },
        { id: 'b', label: '<title>My page</title>' },
        { id: 'c', label: 'title=My page' },
        { id: 'd', label: '<h1 title>My page</h1>' },
      ],
      correctOptionId: 'b',
      explanation: 'Open, text, close with a slash. Same pattern as paragraphs.',
    },
  ],
  reward: {
    gems: 2,
    coins: 15,
    arloLine:
      'Plot twist: you shipped a real webpage skeleton. Rookie no more.',
    badgeId: 'first-step',
    badgeLabel: 'First Step',
  },
};

/** Default outline when template has no hand-authored content. */
export function buildDefaultPlayOutline(input: {
  title: string;
  missionName?: string | null;
  lessonType?: string;
  gems?: number;
  coins?: number;
}): LessonPlayOutline {
  const title = input.title.trim() || 'Untitled lesson';
  const typeLabel = input.lessonType || 'lesson';

  return {
    objective: `Complete this ${typeLabel}: ${title}. Study the idea, try the practice, then pass the quick check.`,
    arloPrompt: `Stuck on “${title}”? Ask me — I’ll break it into tiny steps.`,
    suggestedArlo: [
      `Explain “${title}” like I'm five`,
      'Give me a 60-second recap',
      'Quiz me on the key idea',
    ],
    content: [
      {
        id: 'c1',
        title: 'What you’re learning',
        blocks: [
          { type: 'text', body: `This stop is about: ${title}.` },
          {
            type: 'callout',
            title: 'Arlo says',
            body: 'Read once. Say it back in your own words. Then practice.',
          },
        ],
      },
      {
        id: 'c2',
        title: 'How to win this lesson',
        blocks: [
          {
            type: 'text',
            body: `Goal: finish the ${typeLabel} with enough confidence to explain it out loud.`,
          },
          {
            type: 'callout',
            title: 'Tip',
            body: 'Skim the resource first if one is linked, then come back for practice.',
          },
        ],
      },
    ],
    practice: {
      id: 'p1',
      prompt: `Which move best matches “${title}”?`,
      hint: 'Pick the option that sounds like doing the mission, not avoiding it.',
      options: [
        {
          id: 'a',
          label: `Practice the core idea behind “${title}”`,
          correct: true,
        },
        {
          id: 'b',
          label: 'Skip practice and only memorize the title',
          correct: false,
        },
        {
          id: 'c',
          label: 'Open a random unrelated tutorial',
          correct: false,
        },
      ],
      feedbackCorrect: 'Solid — that’s the move.',
      feedbackIncorrect: 'Close — pick the action that practices the skill.',
    },
    quiz: [
      {
        id: 'q1',
        prompt: 'What is this lesson mainly about?',
        options: [
          { id: 'a', label: title },
          { id: 'b', label: 'Unrelated HTML starter tags' },
          { id: 'c', label: 'A different career track' },
        ],
        correctOptionId: 'a',
        explanation: `Yep — this stop is “${title}”.`,
      },
      {
        id: 'q2',
        prompt: 'Best next step after reading?',
        options: [
          { id: 'a', label: 'Practice, then quiz' },
          { id: 'b', label: 'Close the app forever' },
          { id: 'c', label: 'Ignore the objective' },
        ],
        correctOptionId: 'a',
        explanation: 'Read → practice → quiz. That’s the Arc loop.',
      },
    ],
    reward: {
      gems: input.gems ?? 2,
      coins: input.coins ?? 10,
      arloLine: `Nice — “${title}” is on the map now.`,
      badgeId: null,
      badgeLabel: null,
    },
  };
}

/** Slugs that get the golden HTML Hello World outline. */
export const GOLDEN_OUTLINE_BY_SLUG: Record<string, LessonPlayOutline> = {
  'html-intro-read': HTML_HELLO_WORLD_OUTLINE,
  'selectors-read': HTML_HELLO_WORLD_OUTLINE,
};

export function outlineForTemplateSeed(input: {
  slug: string;
  title: string;
  missionNameTemplate?: string | null;
  lessonType: string;
}): LessonPlayOutline {
  return (
    GOLDEN_OUTLINE_BY_SLUG[input.slug] ??
    buildDefaultPlayOutline({
      title: input.title,
      missionName: input.missionNameTemplate,
      lessonType: input.lessonType,
    })
  );
}
