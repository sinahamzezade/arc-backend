type StemBank = {
  stem: string;
  correct: string;
  wrong: [string, string, string];
};

/** Matches FE battleSubjects after `toLowerCase().replace(/\s+/g, '-')`. */
export const SUBJECTS = [
  'sql',
  'python',
  'excel',
  'data-analysis',
  'frontend',
] as const;

/** Matches FE battleTopics — embedded in slug so topic ILIKE filter works. */
export const TOPICS: Record<(typeof SUBJECTS)[number], string[]> = {
  sql: ['SELECT', 'WHERE', 'JOIN', 'GROUP BY', 'Aggregations'],
  python: ['Lists', 'Dicts', 'Pandas', 'Loops'],
  excel: ['VLOOKUP', 'Pivot', 'Charts'],
  'data-analysis': ['Cleaning', 'EDA', 'Metrics'],
  frontend: ['HTML', 'CSS', 'JS Basics'],
};


export const BANKS: Record<(typeof SUBJECTS)[number], StemBank[]> = {
  sql: [
    {
      stem: 'Which clause filters rows before aggregation?',
      correct: 'WHERE',
      wrong: ['HAVING', 'GROUP BY', 'ORDER BY'],
    },
    {
      stem: 'Which JOIN keeps only matching rows from both tables?',
      correct: 'INNER JOIN',
      wrong: ['LEFT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN'],
    },
    {
      stem: 'What does COUNT(*) count?',
      correct: 'All rows including NULLs in other columns',
      wrong: [
        'Only non-NULL primary keys',
        'Distinct values only',
        'Indexed columns only',
      ],
    },
    {
      stem: 'Which keyword removes duplicate rows from a result set?',
      correct: 'DISTINCT',
      wrong: ['UNIQUE', 'GROUP', 'DEDUP'],
    },
    {
      stem: 'HAVING is typically used with which clause?',
      correct: 'GROUP BY',
      wrong: ['WHERE', 'LIMIT', 'UNION'],
    },
    {
      stem: 'Which aggregate returns the average of a numeric column?',
      correct: 'AVG',
      wrong: ['MEAN', 'MEDIAN', 'SUM'],
    },
    {
      stem: 'What does LIMIT 10 OFFSET 20 return?',
      correct: '10 rows starting after skipping 20',
      wrong: ['First 20 rows', 'Rows 10 through 20', 'Last 10 rows'],
    },
    {
      stem: 'Which constraint prevents duplicate values in a column?',
      correct: 'UNIQUE',
      wrong: ['CHECK', 'DEFAULT', 'FOREIGN KEY'],
    },
    {
      stem: 'A PRIMARY KEY must be:',
      correct: 'UNIQUE and NOT NULL',
      wrong: [
        'Nullable but unique',
        'Always auto-increment',
        'A composite of all columns',
      ],
    },
    {
      stem: 'Which statement changes existing rows?',
      correct: 'UPDATE',
      wrong: ['ALTER', 'INSERT', 'CREATE'],
    },
    {
      stem: 'What does COALESCE(a, b) return?',
      correct: 'First non-NULL among a, b',
      wrong: ['Always a', 'Sum of a and b', 'NULL if either is NULL'],
    },
    {
      stem: 'Which index type is typical for equality lookups on a PK?',
      correct: 'B-tree',
      wrong: ['Hash only', 'Full-text only', 'Bitmap only'],
    },
    {
      stem: 'What does ON DELETE CASCADE do on a foreign key?',
      correct: 'Delete child rows when parent is deleted',
      wrong: ['Prevent parent delete', 'Null child keys', 'Archive parent row'],
    },
    {
      stem: 'Which set operator keeps duplicates by default in SQL?',
      correct: 'UNION ALL',
      wrong: ['UNION', 'INTERSECT', 'EXCEPT'],
    },
    {
      stem: 'Window function ROW_NUMBER() requires which clause?',
      correct: 'OVER (...)',
      wrong: ['GROUP BY only', 'HAVING only', 'WHERE only'],
    },
    {
      stem: 'Which type stores variable-length text?',
      correct: 'VARCHAR / TEXT',
      wrong: ['INT', 'BOOLEAN', 'DATE'],
    },
    {
      stem: 'What is a correlated subquery?',
      correct: 'Inner query that references outer query columns',
      wrong: ['Any nested SELECT', 'A JOIN synonym', 'A materialized CTE'],
    },
    {
      stem: 'EXPLAIN (typically) shows:',
      correct: 'Query execution plan',
      wrong: ['Table DDL', 'User grants', 'Backup status'],
    },
    {
      stem: 'Which isolation level can still see non-repeatable reads?',
      correct: 'READ COMMITTED',
      wrong: ['SERIALIZABLE only', 'Always phantom-free', 'Never allowed'],
    },
    {
      stem: 'NULL = NULL evaluates to:',
      correct: 'UNKNOWN / NULL',
      wrong: ['TRUE', 'FALSE', 'Error'],
    },
    {
      stem: 'Which clause sorts the result set?',
      correct: 'ORDER BY',
      wrong: ['SORT BY', 'GROUP BY', 'ARRANGE'],
    },
    {
      stem: "LIKE 'A%' matches strings that:",
      correct: 'Start with A',
      wrong: ['End with A', 'Contain only A', 'Equal A exactly only'],
    },
    {
      stem: 'A CTE is introduced with which keyword?',
      correct: 'WITH',
      wrong: ['AS SELECT', 'TEMP', 'VIEW'],
    },
    {
      stem: 'Which join can produce a Cartesian product intentionally?',
      correct: 'CROSS JOIN',
      wrong: ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN'],
    },
    {
      stem: 'TRUNCATE TABLE typically:',
      correct: 'Removes all rows quickly, keeps structure',
      wrong: ['Drops the table', 'Deletes one row', 'Only clears indexes'],
    },
  ],
  python: [
    {
      stem: 'What does len([1, 2, 3]) return?',
      correct: '3',
      wrong: ['2', '6', 'None'],
    },
    {
      stem: 'Which type is mutable?',
      correct: 'list',
      wrong: ['tuple', 'str', 'frozenset'],
    },
    {
      stem: 'What does dict.get(k, default) return if k is missing?',
      correct: 'default',
      wrong: ['None always', 'KeyError', 'False'],
    },
    {
      stem: 'List comprehension [x*2 for x in range(3)] yields:',
      correct: '[0, 2, 4]',
      wrong: ['[1, 2, 3]', '[0, 1, 2]', '[2, 4, 6]'],
    },
    {
      stem: 'What does // do between integers?',
      correct: 'Floor division',
      wrong: ['Float division', 'Modulo', 'Power'],
    },
    {
      stem: 'Which keyword defines a generator function?',
      correct: 'yield inside a def',
      wrong: ['generate', 'async only', 'lambda'],
    },
    {
      stem: 'True and False are instances of:',
      correct: 'bool (subclass of int)',
      wrong: ['str', 'NoneType', 'float'],
    },
    {
      stem: 'What does *args collect?',
      correct: 'Extra positional arguments as a tuple',
      wrong: ['Keyword args as a dict', 'Only lists', 'Global variables'],
    },
    {
      stem: 'Which opens a file for writing (truncate)?',
      correct: "open(path, 'w')",
      wrong: ["open(path, 'r')", "open(path, 'a')", "open(path, 'x+') only"],
    },
    {
      stem: 'Exception handling uses which keywords?',
      correct: 'try / except',
      wrong: ['catch / throw', 'rescue / raise', 'handle / error'],
    },
    {
      stem: 'What is None?',
      correct: 'Singleton null-like object',
      wrong: ['Empty list', 'False', '0'],
    },
    {
      stem: 'set([1, 1, 2]) equals:',
      correct: '{1, 2}',
      wrong: ['[1, 1, 2]', '{1, 1, 2}', '(1, 2)'],
    },
    {
      stem: 'Which sorts a list in place?',
      correct: 'list.sort()',
      wrong: ['sorted(list) only', 'list.order()', 'list.reverse_sort()'],
    },
    {
      stem: 'f"{x=}" (3.8+) primarily helps with:',
      correct: 'Debug-friendly self-documenting expressions',
      wrong: ['Type coercion', 'Import aliasing', 'Async await'],
    },
    {
      stem: 'What does is compare?',
      correct: 'Object identity',
      wrong: ['Equality of values only', 'Types only', 'Hashes only'],
    },
    {
      stem: 'Decorators are applied with:',
      correct: '@decorator above a def',
      wrong: ['#decorator', 'decorate:', '::decorator'],
    },
    {
      stem: 'pandas DataFrame default axis=0 means:',
      correct: 'Operate down rows (index axis)',
      wrong: ['Operate across columns', 'Always drop NA', 'Transpose'],
    },
    {
      stem: 'What does pass do?',
      correct: 'No-op placeholder',
      wrong: ['Exit loop', 'Return None explicitly required', 'Skip import'],
    },
    {
      stem: 'enumerate(xs) yields:',
      correct: '(index, value) pairs',
      wrong: ['Only indexes', 'Only values', '(value, index) by default'],
    },
    {
      stem: 'Which creates a virtual environment (stdlib)?',
      correct: 'python -m venv env',
      wrong: ['pip virtual', 'conda only', 'npm init'],
    },
    {
      stem: 'What does __name__ == "__main__" guard?',
      correct: 'Code that runs only when file is executed directly',
      wrong: ['Import-only code', 'Class construction', 'Type checking'],
    },
    {
      stem: 'A dict key must be:',
      correct: 'Hashable',
      wrong: ['Always a str', 'Always an int', 'Mutable list ok'],
    },
    {
      stem: 'What does zip(a, b) do?',
      correct: 'Pairs items from a and b until shortest ends',
      wrong: ['Concatenates lists', 'Merges dicts', 'Sorts both'],
    },
    {
      stem: 'async def defines:',
      correct: 'A coroutine function',
      wrong: ['A thread', 'A process', 'A decorator'],
    },
    {
      stem: 'Which module parses JSON?',
      correct: 'json',
      wrong: ['pickle only', 'yaml only', 'csv'],
    },
  ],
  excel: [
    {
      stem: 'VLOOKUP’s range_lookup TRUE means:',
      correct: 'Approximate match (sorted table)',
      wrong: ['Exact match only', 'Case-sensitive match', 'Wildcard match'],
    },
    {
      stem: 'Which function counts non-empty cells?',
      correct: 'COUNTA',
      wrong: ['COUNTBLANK', 'COUNTIF only', 'SUM'],
    },
    {
      stem: 'Absolute column and row reference uses:',
      correct: '$A$1',
      wrong: ['A$1 only', '$A1 only', 'A1'],
    },
    {
      stem: 'Pivot Tables are mainly for:',
      correct: 'Summarizing and cross-tabulating data',
      wrong: ['Drawing shapes', 'Macros only', 'Email merge'],
    },
    {
      stem: 'IFERROR(value, fallback) returns fallback when:',
      correct: 'value errors',
      wrong: ['value is zero', 'value is blank text only', 'Always'],
    },
    {
      stem: 'XLOOKUP (modern Excel) improves on VLOOKUP by:',
      correct: 'Looking left/right without column index fragility',
      wrong: ['Removing all filters', 'Replacing charts', 'Disabling macros'],
    },
    {
      stem: 'What does CONCAT / TEXTJOIN do?',
      correct: 'Join text strings',
      wrong: ['Split CSV only', 'Sort text', 'Encrypt cells'],
    },
    {
      stem: 'Conditional Formatting changes:',
      correct: 'Cell appearance based on rules',
      wrong: ['Workbook password', 'Pivot cache only', 'Print area only'],
    },
    {
      stem: 'INDEX + MATCH often replaces VLOOKUP because:',
      correct: 'More flexible lookup direction and insert-safe columns',
      wrong: [
        'It is slower always',
        'It only works on Mac',
        'It deletes duplicates',
      ],
    },
    {
      stem: 'What does ROUND(2.56, 1) return?',
      correct: '2.6',
      wrong: ['2.5', '3', '2.56'],
    },
    {
      stem: 'Freeze Panes is used to:',
      correct: 'Keep header rows/cols visible while scrolling',
      wrong: ['Lock workbook forever', 'Hide formulas', 'Protect VBA'],
    },
    {
      stem: 'COUNTIF(range, criteria) counts cells that:',
      correct: 'Meet the criteria',
      wrong: ['Are empty', 'Contain formulas only', 'Are hidden'],
    },
    {
      stem: 'A named range helps by:',
      correct: 'Readable references in formulas',
      wrong: ['Auto-backup', 'Changing file type', 'Disabling calc'],
    },
    {
      stem: 'What does TRIM do?',
      correct: 'Remove extra spaces from text',
      wrong: ['Cut rows', 'Delete sheet', 'Round numbers'],
    },
    {
      stem: 'Data Validation commonly restricts:',
      correct: 'Allowed input values in a cell',
      wrong: ['Chart colors only', 'Pivot layout only', 'Print DPI'],
    },
    {
      stem: 'Goal Seek adjusts an input to hit:',
      correct: 'A target formula result',
      wrong: ['A pivot style', 'A chart type', 'A macro name'],
    },
    {
      stem: 'What does TEXT(date, "YYYY-MM") do?',
      correct: 'Formats date as year-month text',
      wrong: ['Converts to serial only', 'Adds one month', 'Validates date'],
    },
    {
      stem: 'Remove Duplicates acts on:',
      correct: 'Selected columns’ duplicate rows',
      wrong: ['Formulas only', 'Charts only', 'Named styles'],
    },
    {
      stem: 'Flash Fill typically:',
      correct: 'Infers a fill pattern from examples',
      wrong: ['Runs VBA', 'Creates pivots', 'Sends email'],
    },
    {
      stem: 'What does SUMIF do?',
      correct: 'Sums values meeting a condition',
      wrong: ['Counts all cells', 'Averages blindly', 'Sorts a range'],
    },
    {
      stem: 'Protect Sheet can prevent:',
      correct: 'Editing locked cells',
      wrong: ['Opening Excel', 'OS login', 'GPU rendering'],
    },
    {
      stem: 'Sparklines are:',
      correct: 'Mini charts inside cells',
      wrong: ['VBA classes', 'Pivot caches', 'CSV dialects'],
    },
    {
      stem: 'What does LEFT(text, n) return?',
      correct: 'First n characters',
      wrong: ['Last n characters', 'Middle n characters', 'Uppercase text'],
    },
    {
      stem: 'Power Query is mainly for:',
      correct: 'Extracting, transforming, loading data',
      wrong: ['Drawing 3D maps only', 'Writing VBA only', 'Email rules'],
    },
    {
      stem: 'Circular reference means:',
      correct: 'A formula depends on its own cell (directly/indirectly)',
      wrong: ['Two sheets same name', 'Merged cells', 'Hidden columns'],
    },
  ],
  'data-analysis': [
    {
      stem: 'EDA primarily means:',
      correct: 'Exploratory Data Analysis',
      wrong: [
        'Enterprise Data Archive',
        'Event Driven Automation',
        'Exact Duplicate Audit',
      ],
    },
    {
      stem: 'A histogram visualizes:',
      correct: 'Distribution of a numeric variable',
      wrong: ['Network topology', 'Git history', 'API latency only'],
    },
    {
      stem: 'Missing-value strategy “impute mean” replaces NA with:',
      correct: 'Column average',
      wrong: ['Zero always', 'Max value', 'Row index'],
    },
    {
      stem: 'Correlation near 0 suggests:',
      correct: 'Little linear association',
      wrong: ['Perfect causation', 'Identical columns', 'Sorted data'],
    },
    {
      stem: 'Outliers are:',
      correct: 'Points far from typical values',
      wrong: [
        'Always errors to delete',
        'Only negative numbers',
        'Duplicate keys',
      ],
    },
    {
      stem: 'A metric “conversion rate” is typically:',
      correct: 'Conversions / opportunities',
      wrong: ['Sum of revenue only', 'Count of rows', 'Max session length'],
    },
    {
      stem: 'Train/test split helps detect:',
      correct: 'Overfitting to training data',
      wrong: ['Disk failures', 'UI bugs', 'DNS issues'],
    },
    {
      stem: 'Cardinality of a categorical column is:',
      correct: 'Number of distinct categories',
      wrong: ['Byte size', 'Mean value', 'Null count only'],
    },
    {
      stem: 'Normalization to [0,1] often uses:',
      correct: 'Min-max scaling',
      wrong: ['One-hot only', 'SHA hashing', 'Gzip'],
    },
    {
      stem: 'A cohort analysis groups users by:',
      correct: 'Shared start/characteristic period',
      wrong: ['Random UUID only', 'IP address only', 'Font size'],
    },
    {
      stem: 'Precision answers: of predicted positives, how many are:',
      correct: 'Actually positive',
      wrong: ['All negatives', 'All rows', 'Duplicates'],
    },
    {
      stem: 'Recall answers: of actual positives, how many were:',
      correct: 'Found by the model',
      wrong: ['Dropped', 'Imputed', 'Sorted'],
    },
    {
      stem: 'A funnel metric tracks:',
      correct: 'Step-by-step drop-off in a flow',
      wrong: ['CPU temperature', 'Font kerning', 'Git blame'],
    },
    {
      stem: 'Data leakage occurs when:',
      correct: 'Train features include future/target info improperly',
      wrong: ['CSV is large', 'Charts are colorful', 'Nulls exist'],
    },
    {
      stem: 'A/B test primary goal is usually:',
      correct: 'Compare variants on a success metric',
      wrong: ['Delete old data', 'Rename columns', 'Compress images'],
    },
    {
      stem: 'p-value (classic NHST) is NOT:',
      correct: 'Probability that H0 is true',
      wrong: [
        'Related to observed data under H0',
        'Often misinterpreted',
        'Used with alpha thresholds',
      ],
    },
    {
      stem: 'Feature engineering means:',
      correct: 'Creating useful input signals from raw data',
      wrong: ['Buying GPUs', 'Writing CSS', 'Deploying DNS'],
    },
    {
      stem: 'Time-series seasonality refers to:',
      correct: 'Repeating patterns over fixed periods',
      wrong: ['Random noise only', 'Schema drift only', 'Null spikes only'],
    },
    {
      stem: 'A dashboard KPI should be:',
      correct: 'Actionable and measurable',
      wrong: ['Hidden forever', 'Unlabeled', 'Always vanity-only'],
    },
    {
      stem: 'Join fan-out can inflate metrics when:',
      correct: 'One-to-many joins duplicate facts',
      wrong: ['Tables are empty', 'Indexes exist', 'Types match'],
    },
    {
      stem: 'Survivorship bias ignores:',
      correct: 'Entities that dropped out of observation',
      wrong: ['All outliers', 'All means', 'All charts'],
    },
    {
      stem: 'ETL stands for:',
      correct: 'Extract, Transform, Load',
      wrong: [
        'Encrypt, Transfer, Lock',
        'Edit, Test, Launch',
        'Event, Trace, Log',
      ],
    },
    {
      stem: 'A data dictionary documents:',
      correct: 'Field meanings, types, and lineage notes',
      wrong: ['Only chart colors', 'Only passwords', 'Only git SHAs'],
    },
    {
      stem: 'Sampling bias happens when:',
      correct: 'Sample systematically misrepresents population',
      wrong: ['N is large', 'Variance is low', 'Mean equals median'],
    },
    {
      stem: 'Confusion matrix cells include:',
      correct: 'TP, FP, TN, FN',
      wrong: ['Only accuracy', 'Only AUC', 'Only RMSE'],
    },
  ],
  frontend: [
    {
      stem: 'HTML element for the main page landmark is usually:',
      correct: '<main>',
      wrong: ['<bold>', '<marquee>', '<font>'],
    },
    {
      stem: 'CSS box model order outside→in often taught as:',
      correct: 'margin → border → padding → content',
      wrong: ['content → html → body', 'flex → grid → float', 'em → rem → px'],
    },
    {
      stem: 'Which CSS display creates a flex formatting context?',
      correct: 'display: flex',
      wrong: [
        'display: block only',
        'display: table-row only',
        'display: none',
      ],
    },
    {
      stem: 'document.querySelector("#id") returns:',
      correct: 'First matching Element or null',
      wrong: ['Always a NodeList', 'Always throws', 'A CSSRule'],
    },
    {
      stem: 'addEventListener("click", fn) attaches:',
      correct: 'A click handler',
      wrong: ['A CSS class', 'A HTTP header', 'A service worker'],
    },
    {
      stem: 'Which HTTP method is idempotent and typically reads?',
      correct: 'GET',
      wrong: ['POST', 'PATCH always', 'CONNECT'],
    },
    {
      stem: 'localStorage data persists:',
      correct: 'Until cleared; survives tab close',
      wrong: ['Only for the request', 'Never on disk', 'Only in cookies'],
    },
    {
      stem: 'ARIA roles help primarily with:',
      correct: 'Accessibility semantics',
      wrong: ['SEO keywords only', 'Bundle size', 'GPU shaders'],
    },
    {
      stem: 'What does z-index affect?',
      correct: 'Stacking order of positioned elements',
      wrong: ['Font weight', 'Network priority', 'Git merge'],
    },
    {
      stem: 'rem units are relative to:',
      correct: 'Root element font-size',
      wrong: ['Parent only (always)', 'Viewport width only', 'Device DPI only'],
    },
    {
      stem: 'preventDefault() on a submit handler:',
      correct: 'Stops the browser’s default form submit',
      wrong: ['Deletes the form', 'Clears localStorage', 'Closes the tab'],
    },
    {
      stem: 'JSON.stringify turns objects into:',
      correct: 'A JSON string',
      wrong: ['A Map', 'A Blob URL', 'A DOM node'],
    },
    {
      stem: 'CSS Grid’s fr unit distributes:',
      correct: 'Free space as fractions',
      wrong: ['Fixed pixels only', 'Font sizes', 'Z-indexes'],
    },
    {
      stem: 'Which tag loads an external stylesheet?',
      correct: '<link rel="stylesheet" href="...">',
      wrong: [
        '<script src="style.css">',
        '<style href="...">',
        '<css src="...">',
      ],
    },
    {
      stem: 'debounce on an input handler typically:',
      correct: 'Delays running until typing pauses',
      wrong: [
        'Runs every key instantly only',
        'Blocks the UI thread forever',
        'Compresses images',
      ],
    },
    {
      stem: 'Content-Security-Policy mainly mitigates:',
      correct: 'XSS via restricted script sources',
      wrong: ['Slow CSS', 'Large images only', 'Git leaks'],
    },
    {
      stem: 'semantic HTML improves:',
      correct: 'Meaning for browsers/AT/SEO',
      wrong: ['Only animation FPS', 'Only TypeScript types', 'Only DB indexes'],
    },
    {
      stem: 'fetch(url) returns a:',
      correct: 'Promise<Response>',
      wrong: ['string sync', 'XMLHttpRequest only', 'WebSocket'],
    },
    {
      stem: 'position: sticky elements stick within:',
      correct: 'Their containing scroll ancestor',
      wrong: [
        'The entire OS desktop',
        'Only <html> forever',
        'Service workers',
      ],
    },
    {
      stem: 'Which is a boolean HTML attribute pattern?',
      correct: 'disabled on a button',
      wrong: ['color="red" only', 'href always', 'srcset only'],
    },
    {
      stem: 'CSS :focus-visible is useful for:',
      correct: 'Keyboard focus rings without punishing mouse users',
      wrong: ['Print styles only', 'Server caching', 'DNS prefetch'],
    },
    {
      stem: 'module scripts defer by default and are:',
      correct: 'Deferred + module-scoped',
      wrong: ['Always inline only', 'Blocking parse always', 'CSS-only'],
    },
    {
      stem: 'viewport meta tag primarily affects:',
      correct: 'Mobile layout scaling',
      wrong: ['Postgres plans', 'JWT expiry', 'S3 ACLs'],
    },
    {
      stem: 'event.target vs event.currentTarget:',
      correct: 'target = origin node; currentTarget = listener node',
      wrong: [
        'They are always identical',
        'target is window only',
        'currentTarget is CSS',
      ],
    },
    {
      stem: 'Which CSS feature creates responsive breakpoints?',
      correct: '@media queries',
      wrong: ['@keyframes only', '@font-face only', '@import only'],
    },
  ],
};
