import iconNames from './lucide-icon-names.json';

/** PascalCase Lucide export names (from lucide-react `icons`). */
export const LUCIDE_ICON_NAMES: string[] = iconNames;

const LUCIDE_ICON_SET = new Set(LUCIDE_ICON_NAMES);

/** Legacy kebab keys used in questionnaire seed → Lucide PascalCase. */
export const LEGACY_ICON_TO_LUCIDE: Record<string, string> = {
  'bar-chart': 'BarChart3',
  code: 'Code',
  server: 'Server',
  megaphone: 'Megaphone',
  sparkles: 'Sparkles',
  smile: 'Smile',
  zap: 'Zap',
  flame: 'Flame',
  rocket: 'Rocket',
  target: 'Target',
  mountain: 'Mountain',
  briefcase: 'Briefcase',
  clock: 'Clock',
  calendar: 'Calendar',
  'graduation-cap': 'GraduationCap',
  shield: 'Shield',
};

export const DEFAULT_ICON_CLASS =
  'bg-arc-purple-100 text-arc-purple-600';

export function isLucideIconName(name: string): boolean {
  return LUCIDE_ICON_SET.has(name);
}

export function normalizeIconName(raw: string | null | undefined): string {
  const key = (raw ?? '').trim();
  if (!key) return 'Briefcase';
  if (isLucideIconName(key)) return key;
  const legacy = LEGACY_ICON_TO_LUCIDE[key];
  if (legacy && isLucideIconName(legacy)) return legacy;
  const pascal = key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  if (isLucideIconName(pascal)) return pascal;
  return 'Briefcase';
}

export function lucideIconChoices(selected?: string | null) {
  const current = normalizeIconName(selected ?? 'Briefcase');
  return LUCIDE_ICON_NAMES.map((value) => ({
    value,
    label: value,
    selected: current === value,
    className: DEFAULT_ICON_CLASS,
  }));
}
