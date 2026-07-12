export type SeedResource = {
  slug: string;
  title: string;
  url: string;
  provider: string;
  resourceType: 'video' | 'article' | 'docs' | 'course' | 'tool';
  skillTags?: string[];
  techStackSlugs?: string[];
};
export type SeedLesson = {
  slug: string;
  title: string;
  missionNameTemplate?: string;
  lessonType: 'video' | 'reading' | 'practice' | 'quiz' | 'reflection' | 'mini_project';
  estimatedMinutes: number;
  xpReward: number;
  learningStyleTags: string[];
  resourceSlug?: string;
  orderHint: number;
};
export type SeedSkill = {
  slug: string;
  title: string;
  description?: string;
  orderHint: number;
  estimatedHours: number;
  tags: string[];
  prereqSlugs?: string[];
  lessons: SeedLesson[];
};
export type SeedStack = {
  slug: string;
  name: string;
  category: string;
  description: string;
  skills: SeedSkill[];
};
export type SeedRecipePhase = {
  key: string;
  title: string;
  tech_stack_slugs: string[];
  required: boolean;
  include_if_confidence_gte?: string;
};
export type SeedRecipe = {
  targetRoleSlug: string;
  title: string;
  summary: string;
  defaultTimelineWeeks: number;
  phases: SeedRecipePhase[];
};
const L = (
  slug: string, title: string, lessonType: SeedLesson['lessonType'],
  estimatedMinutes: number, xpReward: number, learningStyleTags: string[],
  orderHint: number, resourceSlug?: string,
): SeedLesson => ({
  slug, title, lessonType, estimatedMinutes, xpReward, learningStyleTags, orderHint,
  ...(resourceSlug ? { resourceSlug } : {}),
});
export const CATALOG_SEED: {
  resources: SeedResource[];
  stacks: SeedStack[];
  recipes: SeedRecipe[];
} = {
  resources: [
    { slug: 'mdn-css-selectors', title: 'CSS selectors', url: 'https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Selectors', provider: 'MDN', resourceType: 'docs', skillTags: ['html-css'], techStackSlugs: ['html-css'] },
    { slug: 'mdn-css-layout', title: 'CSS layout', url: 'https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout', provider: 'MDN', resourceType: 'docs', skillTags: ['html-css'], techStackSlugs: ['html-css'] },
    { slug: 'mdn-responsive-design', title: 'Responsive design', url: 'https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design', provider: 'MDN', resourceType: 'docs', skillTags: ['html-css'], techStackSlugs: ['html-css'] },
    { slug: 'mdn-js-guide', title: 'JavaScript Guide', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', provider: 'MDN', resourceType: 'docs', skillTags: ['javascript'], techStackSlugs: ['javascript'] },
    { slug: 'mdn-js-async', title: 'Asynchronous JavaScript', url: 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous', provider: 'MDN', resourceType: 'docs', skillTags: ['javascript'], techStackSlugs: ['javascript'] },
    { slug: 'mdn-js-modules', title: 'JavaScript modules', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules', provider: 'MDN', resourceType: 'docs', skillTags: ['javascript'], techStackSlugs: ['javascript'] },
    { slug: 'react-learn', title: 'Learn React', url: 'https://react.dev/learn', provider: 'react.dev', resourceType: 'docs', techStackSlugs: ['react'] },
    { slug: 'react-hooks', title: 'Built-in React Hooks', url: 'https://react.dev/reference/react/hooks', provider: 'react.dev', resourceType: 'docs', techStackSlugs: ['react'] },
    { slug: 'ts-handbook', title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs/handbook/intro.html', provider: 'TypeScript', resourceType: 'docs', techStackSlugs: ['typescript'] },
    { slug: 'rtl-docs', title: 'Testing Library docs', url: 'https://testing-library.com/docs/react-testing-library/intro/', provider: 'Testing Library', resourceType: 'docs', techStackSlugs: ['testing-library'] },
    { slug: 'w3schools-sql', title: 'SQL Tutorial', url: 'https://www.w3schools.com/sql/', provider: 'W3Schools', resourceType: 'docs', skillTags: ['sql'], techStackSlugs: ['sql'] },
    { slug: 'python-tutorial', title: 'Python tutorial', url: 'https://docs.python.org/3/tutorial/', provider: 'Python', resourceType: 'docs', skillTags: ['python'], techStackSlugs: ['python'] },
    { slug: 'pandas-getting-started', title: 'Pandas getting started', url: 'https://pandas.pydata.org/docs/getting_started/index.html', provider: 'Pandas', resourceType: 'docs', skillTags: ['python'], techStackSlugs: ['python'] },
    { slug: 'mdn-seo-basics', title: 'SEO basics for developers', url: 'https://developer.mozilla.org/en-US/docs/Glossary/SEO', provider: 'MDN', resourceType: 'article', skillTags: ['marketing-seo'], techStackSlugs: ['marketing-seo'] },
    { slug: 'chartjs-docs', title: 'Chart.js documentation', url: 'https://www.chartjs.org/docs/latest/', provider: 'Chart.js', resourceType: 'docs', skillTags: ['data-viz'], techStackSlugs: ['data-viz'] },
  ],

  stacks: [
    {
      slug: 'html-css',
      name: 'HTML & CSS',
      category: 'frontend',
      description: 'Structure pages and style layouts for the modern web.',
      skills: [
        {
          slug: 'selectors', title: 'CSS Selectors', orderHint: 1, estimatedHours: 4, tags: ['html-css'],
          lessons: [
            L('selectors-read', 'Selector fundamentals', 'reading', 25, 40, ['reading'], 1, 'mdn-css-selectors'),
            L('selectors-practice', 'Target elements with selectors', 'practice', 35, 60, ['doing'], 2),
            L('selectors-video', 'Selectors in the cascade', 'video', 20, 35, ['videos'], 3),
          ],
        },
        {
          slug: 'layout', title: 'CSS Layout', orderHint: 2, estimatedHours: 6, tags: ['html-css'], prereqSlugs: ['selectors'],
          lessons: [
            L('layout-read', 'Flexbox and Grid overview', 'reading', 30, 45, ['reading'], 1, 'mdn-css-layout'),
            L('layout-practice', 'Build a two-column layout', 'practice', 45, 70, ['doing'], 2),
          ],
        },
        {
          slug: 'responsive', title: 'Responsive Design', orderHint: 3, estimatedHours: 5, tags: ['html-css'], prereqSlugs: ['layout'],
          lessons: [
            L('responsive-read', 'Media queries and fluid units', 'reading', 25, 40, ['reading'], 1, 'mdn-responsive-design'),
            L('responsive-practice', 'Make a page mobile-friendly', 'practice', 40, 65, ['doing'], 2),
            L('responsive-video', 'Mobile-first workflow', 'video', 18, 30, ['videos'], 3),
          ],
        },
      ],
    },
    {
      slug: 'javascript',
      name: 'JavaScript',
      category: 'frontend',
      description: 'Core language skills for interactive web apps.',
      skills: [
        {
          slug: 'es6', title: 'ES6+ Syntax', orderHint: 1, estimatedHours: 6, tags: ['javascript'],
          lessons: [
            L('es6-read', 'Let, const, and arrow functions', 'reading', 30, 45, ['reading'], 1, 'mdn-js-guide'),
            L('es6-practice', 'Rewrite scripts with modern syntax', 'practice', 40, 65, ['doing'], 2),
            L('es6-video', 'Destructuring and spread', 'video', 22, 35, ['videos'], 3),
          ],
        },
        {
          slug: 'async', title: 'Async JavaScript', orderHint: 2, estimatedHours: 6, tags: ['javascript'], prereqSlugs: ['es6'],
          lessons: [
            L('async-read', 'Promises and async/await', 'reading', 30, 45, ['reading'], 1, 'mdn-js-async'),
            L('async-practice', 'Fetch and handle API errors', 'practice', 45, 70, ['doing'], 2),
          ],
        },
        {
          slug: 'modules', title: 'JS Modules', orderHint: 3, estimatedHours: 4, tags: ['javascript'], prereqSlugs: ['es6'],
          lessons: [
            L('modules-read', 'Import and export patterns', 'reading', 20, 35, ['reading'], 1, 'mdn-js-modules'),
            L('modules-practice', 'Split a script into modules', 'practice', 35, 55, ['doing'], 2),
            L('modules-video', 'Module bundling basics', 'video', 18, 30, ['videos'], 3),
          ],
        },
      ],
    },
    {
      slug: 'react',
      name: 'React',
      category: 'frontend',
      description: 'Build UIs with components, hooks, and state.',
      skills: [
        {
          slug: 'jsx-basics', title: 'JSX Basics', orderHint: 1, estimatedHours: 4, tags: [], prereqSlugs: ['javascript:es6'],
          lessons: [
            L('jsx-read', 'JSX and elements', 'reading', 25, 40, ['reading'], 1, 'react-learn'),
            L('jsx-practice', 'Render a static profile card', 'practice', 35, 55, ['doing'], 2),
          ],
        },
        {
          slug: 'components', title: 'Components & Props', orderHint: 2, estimatedHours: 5, tags: [], prereqSlugs: ['jsx-basics'],
          lessons: [
            L('components-video', 'Thinking in components', 'video', 20, 35, ['videos'], 1, 'react-learn'),
            L('components-practice', 'Compose a card list', 'practice', 40, 65, ['doing'], 2),
            L('components-read', 'Props and children', 'reading', 20, 35, ['reading'], 3),
          ],
        },
        {
          slug: 'hooks', title: 'React Hooks', orderHint: 3, estimatedHours: 6, tags: [], prereqSlugs: ['components'],
          lessons: [
            L('hooks-read', 'useState and useEffect', 'reading', 30, 45, ['reading'], 1, 'react-hooks'),
            L('hooks-practice', 'Build a counter with effects', 'practice', 40, 65, ['doing'], 2),
          ],
        },
        {
          slug: 'state', title: 'State Management', orderHint: 4, estimatedHours: 5, tags: [], prereqSlugs: ['hooks'],
          lessons: [
            L('state-video', 'Lifting state up', 'video', 22, 35, ['videos'], 1),
            L('state-practice', 'Shared form state', 'practice', 45, 70, ['doing'], 2),
            L('state-read', 'Derived vs stored state', 'reading', 20, 35, ['reading'], 3),
          ],
        },
      ],
    },
    {
      slug: 'typescript',
      name: 'TypeScript',
      category: 'frontend',
      description: 'Add static types to JavaScript and React apps.',
      skills: [
        {
          slug: 'types-basics', title: 'TypeScript Basics', orderHint: 1, estimatedHours: 5, tags: [], prereqSlugs: ['javascript:es6'],
          lessons: [
            L('types-read', 'Types, interfaces, and unions', 'reading', 30, 45, ['reading'], 1, 'ts-handbook'),
            L('types-practice', 'Annotate a utility module', 'practice', 40, 65, ['doing'], 2),
          ],
        },
        {
          slug: 'react-typescript', title: 'React + TypeScript', orderHint: 2, estimatedHours: 5, tags: [], prereqSlugs: ['types-basics', 'react:components'],
          lessons: [
            L('rts-video', 'Typing props and hooks', 'video', 22, 35, ['videos'], 1),
            L('rts-practice', 'Type a component library', 'practice', 45, 70, ['doing'], 2),
            L('rts-read', 'Generic components', 'reading', 20, 35, ['reading'], 3),
          ],
        },
      ],
    },
    {
      slug: 'testing-library',
      name: 'Testing Library',
      category: 'frontend',
      description: 'Test React components the way users interact.',
      skills: [
        {
          slug: 'component-tests', title: 'Component Tests', orderHint: 1, estimatedHours: 5, tags: [], prereqSlugs: ['react:hooks'],
          lessons: [
            L('ctl-read', 'Queries and user events', 'reading', 25, 40, ['reading'], 1, 'rtl-docs'),
            L('ctl-practice', 'Test a login form', 'practice', 45, 70, ['doing'], 2),
            L('ctl-video', 'Accessible queries walkthrough', 'video', 18, 30, ['videos'], 3),
          ],
        },
      ],
    },
    {
      slug: 'portfolio',
      name: 'Portfolio',
      category: 'career',
      description: 'Plan and ship a public project that proves your skills.',
      skills: [
        {
          slug: 'project-plan', title: 'Project Planning', orderHint: 1, estimatedHours: 4, tags: [],
          lessons: [
            L('plan-read', 'Scope a portfolio piece', 'reading', 20, 35, ['reading'], 1),
            L('plan-practice', 'Write a one-pager MVP plan', 'practice', 35, 55, ['doing'], 2),
            L('plan-reflect', 'Risks and success criteria', 'reflection', 15, 25, ['reflection'], 3),
          ],
        },
        {
          slug: 'ship-app', title: 'Ship the App', orderHint: 2, estimatedHours: 8, tags: [], prereqSlugs: ['project-plan'],
          lessons: [
            L('ship-video', 'Deploy to production', 'video', 25, 40, ['videos'], 1),
            L('ship-practice', 'Launch and write a README', 'practice', 50, 80, ['doing'], 2),
            L('ship-project', 'Polish and share the live URL', 'mini_project', 60, 100, ['doing'], 3),
          ],
        },
      ],
    },
    {
      slug: 'interview-prep',
      name: 'Interview Prep',
      category: 'career',
      description: 'Prepare for frontend interviews and common questions.',
      skills: [
        {
          slug: 'fe-system-design-lite', title: 'FE System Design Lite', orderHint: 1, estimatedHours: 5, tags: [],
          lessons: [
            L('sd-read', 'Component architecture tradeoffs', 'reading', 25, 40, ['reading'], 1),
            L('sd-practice', 'Sketch a feed UI design', 'practice', 40, 65, ['doing'], 2),
          ],
        },
        {
          slug: 'common-questions', title: 'Common Questions', orderHint: 2, estimatedHours: 4, tags: [],
          lessons: [
            L('cq-video', 'Behavioral interview framing', 'video', 20, 35, ['videos'], 1),
            L('cq-practice', 'Answer five FE questions aloud', 'practice', 35, 55, ['doing'], 2),
            L('cq-quiz', 'Quick FE concepts check', 'quiz', 15, 30, ['quiz'], 3),
          ],
        },
      ],
    },
    {
      slug: 'sql',
      name: 'SQL',
      category: 'data',
      description: 'Query relational data with SELECT and joins.',
      skills: [
        {
          slug: 'select-basics', title: 'SELECT Basics', orderHint: 1, estimatedHours: 4, tags: ['sql'],
          lessons: [
            L('select-read', 'SELECT, WHERE, ORDER BY', 'reading', 25, 40, ['reading'], 1, 'w3schools-sql'),
            L('select-practice', 'Filter and sort a sample table', 'practice', 35, 55, ['doing'], 2),
          ],
        },
        {
          slug: 'joins', title: 'SQL Joins', orderHint: 2, estimatedHours: 5, tags: ['sql'], prereqSlugs: ['select-basics'],
          lessons: [
            L('joins-video', 'INNER vs LEFT joins', 'video', 20, 35, ['videos'], 1),
            L('joins-practice', 'Join orders and customers', 'practice', 40, 65, ['doing'], 2),
            L('joins-read', 'Join patterns cheat sheet', 'reading', 15, 25, ['reading'], 3, 'w3schools-sql'),
          ],
        },
      ],
    },
    {
      slug: 'excel',
      name: 'Excel',
      category: 'data',
      description: 'Analyze tabular data with formulas and pivots.',
      skills: [
        {
          slug: 'formulas', title: 'Excel Formulas', orderHint: 1, estimatedHours: 4, tags: ['excel'],
          lessons: [
            L('formulas-video', 'Core formula patterns', 'video', 22, 35, ['videos'], 1),
            L('formulas-practice', 'Build a budget sheet', 'practice', 40, 65, ['doing'], 2),
          ],
        },
        {
          slug: 'pivot', title: 'Pivot Tables', orderHint: 2, estimatedHours: 4, tags: ['excel'], prereqSlugs: ['formulas'],
          lessons: [
            L('pivot-read', 'Pivot table anatomy', 'reading', 20, 35, ['reading'], 1),
            L('pivot-practice', 'Summarize sales by region', 'practice', 40, 65, ['doing'], 2),
            L('pivot-video', 'Slicers and calculated fields', 'video', 18, 30, ['videos'], 3),
          ],
        },
      ],
    },
    {
      slug: 'python',
      name: 'Python',
      category: 'data',
      description: 'Python syntax and pandas for analysis workflows.',
      skills: [
        {
          slug: 'syntax', title: 'Python Syntax', orderHint: 1, estimatedHours: 5, tags: ['python'],
          lessons: [
            L('py-read', 'Variables, loops, and functions', 'reading', 30, 45, ['reading'], 1, 'python-tutorial'),
            L('py-practice', 'Write a CLI data cleaner', 'practice', 40, 65, ['doing'], 2),
          ],
        },
        {
          slug: 'pandas-basics', title: 'Pandas Basics', orderHint: 2, estimatedHours: 6, tags: ['python'], prereqSlugs: ['syntax'],
          lessons: [
            L('pd-video', 'DataFrames overview', 'video', 22, 35, ['videos'], 1),
            L('pd-practice', 'Filter and aggregate a CSV', 'practice', 45, 70, ['doing'], 2),
            L('pd-read', 'Getting started with pandas', 'reading', 25, 40, ['reading'], 3, 'pandas-getting-started'),
          ],
        },
      ],
    },
    {
      slug: 'data-viz',
      name: 'Data Visualization',
      category: 'data',
      description: 'Turn datasets into clear charts and visual stories.',
      skills: [
        {
          slug: 'charts', title: 'Charts', orderHint: 1, estimatedHours: 4, tags: ['data-viz'],
          lessons: [
            L('charts-read', 'Choosing the right chart', 'reading', 20, 35, ['reading'], 1, 'chartjs-docs'),
            L('charts-practice', 'Build a bar and line chart', 'practice', 40, 65, ['doing'], 2),
            L('charts-video', 'Chart.js quickstart', 'video', 18, 30, ['videos'], 3),
          ],
        },
      ],
    },
    {
      slug: 'communication',
      name: 'Communication',
      category: 'soft-skills',
      description: 'Tell clear stories with data and recommendations.',
      skills: [
        {
          slug: 'storytelling', title: 'Storytelling', orderHint: 1, estimatedHours: 3, tags: ['communication'],
          lessons: [
            L('story-read', 'Insight → recommendation structure', 'reading', 20, 35, ['reading'], 1),
            L('story-practice', 'Write a one-slide narrative', 'practice', 30, 50, ['doing'], 2),
            L('story-reflect', 'Audience and call to action', 'reflection', 15, 25, ['reflection'], 3),
          ],
        },
      ],
    },
    {
      slug: 'marketing-seo',
      name: 'Marketing & SEO',
      category: 'marketing',
      description: 'Find keywords and improve on-page SEO.',
      skills: [
        {
          slug: 'keywords', title: 'Keyword Research', orderHint: 1, estimatedHours: 4, tags: ['marketing-seo'],
          lessons: [
            L('kw-read', 'SEO glossary and intent', 'reading', 20, 35, ['reading'], 1, 'mdn-seo-basics'),
            L('kw-practice', 'Build a keyword shortlist', 'practice', 35, 55, ['doing'], 2),
          ],
        },
        {
          slug: 'on-page', title: 'On-Page SEO', orderHint: 2, estimatedHours: 4, tags: ['marketing-seo'], prereqSlugs: ['keywords'],
          lessons: [
            L('onpage-video', 'Titles, meta, and headings', 'video', 20, 35, ['videos'], 1),
            L('onpage-practice', 'Audit and rewrite a landing page', 'practice', 40, 65, ['doing'], 2),
            L('onpage-read', 'Technical SEO checklist', 'reading', 18, 30, ['reading'], 3, 'mdn-seo-basics'),
          ],
        },
      ],
    },
  ],

  recipes: [
    {
      targetRoleSlug: 'front-end-developer',
      title: 'Front-End Developer Path',
      summary: 'HTML/CSS and JS foundations, React core, optional advanced stack, then portfolio and interviews.',
      defaultTimelineWeeks: 24,
      phases: [
        { key: 'foundations', title: 'Foundations', tech_stack_slugs: ['html-css', 'javascript'], required: true },
        { key: 'react-core', title: 'React Core', tech_stack_slugs: ['react'], required: true },
        { key: 'react-advanced', title: 'React Advanced', tech_stack_slugs: ['typescript', 'react', 'testing-library'], required: false, include_if_confidence_gte: 'somewhat' },
        { key: 'portfolio', title: 'Portfolio & Interviews', tech_stack_slugs: ['portfolio', 'interview-prep'], required: true },
      ],
    },
    {
      targetRoleSlug: 'data-analyst',
      title: 'Data Analyst Path',
      summary: 'Excel and SQL foundations, Python and visualization core, optional storytelling soft skills.',
      defaultTimelineWeeks: 24,
      phases: [
        { key: 'foundations', title: 'Foundations', tech_stack_slugs: ['excel', 'sql'], required: true },
        { key: 'core', title: 'Analysis Core', tech_stack_slugs: ['python', 'data-viz'], required: true },
        { key: 'soft', title: 'Communication', tech_stack_slugs: ['communication'], required: false, include_if_confidence_gte: 'somewhat' },
      ],
    },
    {
      targetRoleSlug: 'back-end-developer',
      title: 'Back-End Developer Path',
      summary: 'JavaScript language core, Python services, and SQL data layer for API-focused backends.',
      defaultTimelineWeeks: 24,
      phases: [
        { key: 'language-core', title: 'Language Core', tech_stack_slugs: ['javascript'], required: true },
        { key: 'services', title: 'Services & Scripting', tech_stack_slugs: ['python'], required: true },
        { key: 'data-layer', title: 'Data Layer', tech_stack_slugs: ['sql'], required: true },
      ],
    },
    {
      targetRoleSlug: 'marketing-specialist',
      title: 'Marketing Specialist Path',
      summary: 'SEO fundamentals, clear communication, and light data visualization for campaigns.',
      defaultTimelineWeeks: 20,
      phases: [
        { key: 'seo', title: 'SEO Foundations', tech_stack_slugs: ['marketing-seo'], required: true },
        { key: 'comms', title: 'Campaign Communication', tech_stack_slugs: ['communication'], required: true },
        { key: 'insights', title: 'Insights & Charts', tech_stack_slugs: ['data-viz'], required: true },
      ],
    },
  ],
};
