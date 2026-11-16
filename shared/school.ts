// School work: homework, tests and projects with a due date, per kid. Shown on the kid's board, the parent home and
// the calendar.

export const SCHOOL_KINDS = [
  { id: 'homework', label: 'Homework', icon: '✏️', done: 'Turned in' },
  { id: 'test', label: 'Test or quiz', icon: '📝', done: 'Taken' },
  { id: 'project', label: 'Project', icon: '🔬', done: 'Turned in' },
] as const;
export type SchoolKind = (typeof SCHOOL_KINDS)[number]['id'];
export const SCHOOL_KIND_IDS = SCHOOL_KINDS.map((k) => k.id) as SchoolKind[];
export const schoolIcon = (kind: string): string => SCHOOL_KINDS.find((k) => k.id === kind)?.icon ?? '🎒';

export const SUBJECTS = [
  { id: 'Math', icon: '🔢' }, { id: 'Reading', icon: '📖' }, { id: 'Writing', icon: '✍️' }, { id: 'Language Arts', icon: '🔤' },
  { id: 'Science', icon: '🔬' }, { id: 'Social Studies', icon: '🌎' }, { id: 'History', icon: '🏛️' }, { id: 'Spelling', icon: '🐝' },
  { id: 'Art', icon: '🎨' }, { id: 'Music', icon: '🎵' }, { id: 'PE', icon: '⚽' }, { id: 'Spanish', icon: '🗣️' },
] as const;
export const subjectIcon = (s: string | null | undefined): string => SUBJECTS.find((x) => x.id.toLowerCase() === (s ?? '').toLowerCase())?.icon ?? '📚';

/** Where a piece of school work stands, for sorting and the colored tag. */
export type DueState = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' | 'done';

export function dueState(dueDate: string, today: string, done: boolean): DueState {
  if (done) return 'done';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const days = daysBetween(today, dueDate);
  if (days === 1) return 'tomorrow';
  return days <= 7 ? 'soon' : 'later';
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/** A family calendar event that looks like school work ("Science SOL", "Math Test", "Book report due"). */
const SCHOOL_WORDS: [RegExp, SchoolKind][] = [
  [/\b(test|quiz|exam|sol|assessment|benchmark|final|midterm|spelling bee)\b/i, 'test'],
  [/\b(project|report|poster|diorama|science fair|presentation)\b/i, 'project'],
  [/\b(homework|worksheet|assignment|due|packet|reading log)\b/i, 'homework'],
];
export function schoolKindOf(title: string): SchoolKind | null {
  for (const [re, kind] of SCHOOL_WORDS) if (re.test(title)) return kind;
  return null;
}

/** "Math Test" → Math; "Science SOL" → Science. */
export function subjectOf(title: string): string | null {
  const t = title.toLowerCase();
  const alias: [string, string][] = [['language arts', 'Language Arts'], ['ela', 'Language Arts'], ['social studies', 'Social Studies'], ['virginia', 'Social Studies'],
    ['colonial', 'Social Studies'], ['spelling', 'Spelling'], ['math', 'Math'], ['multiplication', 'Math'], ['division', 'Math'], ['fraction', 'Math'], ['science', 'Science'],
    ['reading', 'Reading'], ['book', 'Reading'], ['writing', 'Writing'], ['history', 'History'], ['spanish', 'Spanish'], ['art', 'Art'], ['music', 'Music']];
  for (const [word, subject] of alias) if (new RegExp(`\\b${word}\\b`).test(t)) return subject;
  return null;
}
