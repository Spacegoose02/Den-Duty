// Learning time: a few questions a day matched to each kid's grade, lined up with Virginia's standards (the Standards of
// Learning for K to 5, the Foundation Blocks for pre-K). Every question is multiple choice with big buttons, so it works
// on the tablet and with read-aloud. A "Talk & play" level is for kids working on speech and language: tap the picture,
// no reading needed. Skills a kid misses come up more often; skills they've got come up less.
//
// Questions are made from a seed, so the server only stores which skill and which seed, and the same card looks the same
// after a reload.

import { ageOn } from './ages.ts';

// ---------- levels ----------

export const LEVELS = [
  { id: 'talk', label: 'Talk & play', short: 'Talk', hint: 'Speech and language: tap the picture, no reading' },
  { id: 'pk', label: 'Pre-K', short: 'Pre-K', hint: 'Virginia Foundation Blocks for Early Learning' },
  { id: 'k', label: 'Kindergarten', short: 'K', hint: 'Virginia SOL, kindergarten' },
  { id: '1', label: '1st grade', short: '1st', hint: 'Virginia SOL, grade 1' },
  { id: '2', label: '2nd grade', short: '2nd', hint: 'Virginia SOL, grade 2' },
  { id: '3', label: '3rd grade', short: '3rd', hint: 'Virginia SOL, grade 3' },
  { id: '4', label: '4th grade', short: '4th', hint: 'Virginia SOL, grade 4 (with Virginia Studies)' },
  { id: '5', label: '5th grade', short: '5th', hint: 'Virginia SOL, grade 5' },
] as const;
export type Level = (typeof LEVELS)[number]['id'];
export const LEVEL_IDS = LEVELS.map((l) => l.id) as Level[];
/** School grades in order. "Talk & play" sits outside: it never moves up by itself. */
export const GRADE_ORDER: Level[] = ['pk', 'k', '1', '2', '3', '4', '5'];
export const levelInfo = (id: string | null | undefined) => LEVELS.find((l) => l.id === id) ?? null;
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVEL_IDS as string[]).includes(v);

/** The school year a date falls in, by the year it starts: grades move up on July 1. 2026-11-23 → 2026. */
export function schoolYear(today: string): number {
  const [y, m] = today.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

/**
 * The grade a kid is in by age, the Virginia way: kindergarten is for kids who turn 5 on or before September 30 of that
 * school year. Null without a birthdate or for kids under 4 by then.
 */
export function levelByAge(birthdate: string | null | undefined, today: string): Level | null {
  if (!birthdate) return null;
  const age = ageOn(birthdate, `${schoolYear(today)}-09-30`);
  if (age == null || age < 4) return null;
  return GRADE_ORDER[Math.min(age - 4, GRADE_ORDER.length - 1)];
}

/**
 * The level a kid works at today. A grade a parent picked moves up one each school year after the one it was picked in
 * (and stops at the last grade there are questions for). Nothing picked: by age.
 */
export function currentLevel(stored: string | null | undefined, setYear: number | null | undefined, birthdate: string | null | undefined, today: string): { level: Level | null; auto: boolean } {
  if (!isLevel(stored)) return { level: levelByAge(birthdate, today), auto: true };
  if (stored === 'talk' || setYear == null) return { level: stored, auto: false };
  const i = GRADE_ORDER.indexOf(stored) + Math.max(0, schoolYear(today) - setYear);
  return { level: GRADE_ORDER[Math.min(i, GRADE_ORDER.length - 1)], auto: false };
}

/** Kids who learn with pictures and sound first: questions read themselves out and answers are pictures. */
export const readsFirst = (level: Level | null): boolean => level === 'talk' || level === 'pk' || level === 'k';

// ---------- subjects ----------

export const SUBJECTS = [
  { id: 'math', label: 'Math', icon: '🔢' },
  { id: 'reading', label: 'Reading & words', icon: '📖' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'social', label: 'History & social studies', icon: '🏛️' },
  { id: 'talk', label: 'Talk & listen', icon: '🗣️' },
] as const;
export type Subject = (typeof SUBJECTS)[number]['id'];
export const SUBJECT_IDS = SUBJECTS.map((s) => s.id) as Subject[];
export const subjectInfo = (id: string) => SUBJECTS.find((s) => s.id === id);

// ---------- questions ----------

export interface Choice { text: string; pic?: string }
export interface Question {
  skill: string;
  /** What's written on the card. */
  prompt: string;
  /** What read-aloud says (defaults to the prompt). */
  say?: string;
  /** Something big to look at: emoji, a number sentence, a clock. */
  show?: string;
  choices: Choice[];
  /** Index of the right choice. */
  answer: number;
  /** One line on why, shown after answering. */
  why: string;
  /** Answer with pictures (big emoji buttons, the word under them). */
  pictures?: boolean;
}

export interface Ctx { name: string }

export interface Skill {
  id: string; level: Level; subject: Subject; label: string;
  /** Which part of the standards it practices. */
  area: string;
  make: (r: Rng, c: Ctx) => Omit<Question, 'skill'>;
}

// ---------- randomness from a seed ----------

export type Rng = () => number;
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rngFrom(seed: string): Rng {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
function shuffle<T>(r: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const sample = <T,>(r: Rng, list: readonly T[], n: number): T[] => shuffle(r, list).slice(0, n);

/** Shuffles the right answer in with the wrong ones (dropping repeats) and remembers where it landed. */
function choose(r: Rng, right: Choice, wrong: Choice[], max = 4): { choices: Choice[]; answer: number } {
  const seen = new Set([right.text]);
  const others = wrong.filter((w) => !seen.has(w.text) && seen.add(w.text)).slice(0, max - 1);
  const choices = shuffle(r, [right, ...others]);
  return { choices, answer: choices.findIndex((c) => c.text === right.text) };
}
const txt = (s: string | number): Choice => ({ text: String(s) });

/** Number choices near the answer: off by one, by ten, a mixed-up digit. Never negative. */
function nums(r: Rng, answer: number, spread: number[] = [1, -1, 2, -2, 10, -10]): { choices: Choice[]; answer: number } {
  const wrong = shuffle(r, spread).map((d) => answer + d).filter((n) => n >= 0 && n !== answer);
  return choose(r, txt(answer), wrong.map(txt), 4);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const repeat = (s: string, n: number) => Array.from({ length: n }, () => s).join('');
/** Emoji in rows of five, so a kid can count them. */
const counted = (s: string, n: number) => Array.from({ length: Math.ceil(n / 5) }, (_, i) => repeat(s, Math.min(5, n - i * 5))).join('\n');

// A bank of ready-made questions: [prompt, right answer, wrong answers, why, something to show].
type Item = readonly [prompt: string, right: string, wrong: readonly string[], why: string, show?: string];
const bank = (items: readonly Item[]) => (r: Rng): Omit<Question, 'skill'> => {
  const [prompt, right, wrong, why, show] = pick(r, items);
  return { prompt, show, why, ...choose(r, txt(right), wrong.map(txt)) };
};

// ---------- pictures for the youngest ----------

interface Thing { word: string; pic: string; kind: 'animal' | 'food' | 'wear' | 'go' | 'home' | 'outside' }
const THINGS: Thing[] = [
  { word: 'dog', pic: '🐶', kind: 'animal' }, { word: 'cat', pic: '🐱', kind: 'animal' }, { word: 'fish', pic: '🐟', kind: 'animal' },
  { word: 'bird', pic: '🐦', kind: 'animal' }, { word: 'duck', pic: '🦆', kind: 'animal' }, { word: 'cow', pic: '🐮', kind: 'animal' },
  { word: 'pig', pic: '🐷', kind: 'animal' }, { word: 'horse', pic: '🐴', kind: 'animal' }, { word: 'frog', pic: '🐸', kind: 'animal' },
  { word: 'bear', pic: '🐻', kind: 'animal' }, { word: 'bunny', pic: '🐰', kind: 'animal' }, { word: 'monkey', pic: '🐵', kind: 'animal' },
  { word: 'apple', pic: '🍎', kind: 'food' }, { word: 'banana', pic: '🍌', kind: 'food' }, { word: 'cookie', pic: '🍪', kind: 'food' },
  { word: 'egg', pic: '🥚', kind: 'food' }, { word: 'milk', pic: '🥛', kind: 'food' }, { word: 'pizza', pic: '🍕', kind: 'food' },
  { word: 'carrot', pic: '🥕', kind: 'food' }, { word: 'grapes', pic: '🍇', kind: 'food' }, { word: 'cheese', pic: '🧀', kind: 'food' },
  { word: 'hat', pic: '🧢', kind: 'wear' }, { word: 'shoe', pic: '👟', kind: 'wear' }, { word: 'sock', pic: '🧦', kind: 'wear' },
  { word: 'shirt', pic: '👕', kind: 'wear' }, { word: 'coat', pic: '🧥', kind: 'wear' }, { word: 'glasses', pic: '👓', kind: 'wear' },
  { word: 'car', pic: '🚗', kind: 'go' }, { word: 'bus', pic: '🚌', kind: 'go' }, { word: 'train', pic: '🚂', kind: 'go' },
  { word: 'boat', pic: '⛵', kind: 'go' }, { word: 'airplane', pic: '✈️', kind: 'go' }, { word: 'bike', pic: '🚲', kind: 'go' },
  { word: 'ball', pic: '⚽', kind: 'home' }, { word: 'cup', pic: '🥤', kind: 'home' }, { word: 'bed', pic: '🛏️', kind: 'home' },
  { word: 'book', pic: '📖', kind: 'home' }, { word: 'spoon', pic: '🥄', kind: 'home' }, { word: 'key', pic: '🔑', kind: 'home' },
  { word: 'toothbrush', pic: '🪥', kind: 'home' }, { word: 'chair', pic: '🪑', kind: 'home' },
  { word: 'sun', pic: '☀️', kind: 'outside' }, { word: 'moon', pic: '🌙', kind: 'outside' }, { word: 'tree', pic: '🌳', kind: 'outside' },
  { word: 'flower', pic: '🌸', kind: 'outside' }, { word: 'star', pic: '⭐', kind: 'outside' }, { word: 'rain', pic: '🌧️', kind: 'outside' },
];
const thing = (word: string) => THINGS.find((t) => t.word === word)!;
const picOf = (t: Thing): Choice => ({ text: t.word, pic: t.pic });
const KIND_NAME: Record<Thing['kind'], string> = { animal: 'an animal', food: 'a food', wear: 'something you wear', go: 'something that goes', home: 'something in the house', outside: 'something outside' };

/** "Find the …": one picture and two or three others not like it. */
function findPicture(r: Rng, pool: Thing[], n = 3, say = (t: Thing) => `Find the ${t.word}.`): Omit<Question, 'skill'> {
  const [right, ...wrong] = sample(r, pool, n);
  return { prompt: say(right), why: `That's the ${right.word}! ${right.pic}`, pictures: true, ...choose(r, picOf(right), wrong.map(picOf)) };
}

const COLORS = [
  { word: 'red', pic: '🔴' }, { word: 'blue', pic: '🔵' }, { word: 'green', pic: '🟢' }, { word: 'yellow', pic: '🟡' },
  { word: 'orange', pic: '🟠' }, { word: 'purple', pic: '🟣' }, { word: 'brown', pic: '🟤' },
];
const SHAPES = [
  { word: 'circle', pic: '⚪' }, { word: 'triangle', pic: '🔺' }, { word: 'square', pic: '🟥' }, { word: 'star', pic: '⭐' },
  { word: 'heart', pic: '❤️' }, { word: 'diamond', pic: '🔷' },
];
const SOUNDS = [
  { word: 'cow', sound: 'Moo' }, { word: 'dog', sound: 'Woof' }, { word: 'cat', sound: 'Meow' }, { word: 'duck', sound: 'Quack' },
  { word: 'pig', sound: 'Oink' }, { word: 'horse', sound: 'Neigh' }, { word: 'frog', sound: 'Ribbit' }, { word: 'bird', sound: 'Tweet' },
];
/** What we use things for: picture answers that build "what do you do with it" language. */
const USES: [string, string][] = [
  ['What do you drink from?', 'cup'], ['What do you wear on your feet?', 'shoe'], ['What do you sleep in?', 'bed'],
  ['What do you read?', 'book'], ['What do you brush your teeth with?', 'toothbrush'], ['What do you eat soup with?', 'spoon'],
  ['What opens a door?', 'key'], ['What do you wear on your head?', 'hat'], ['What do you sit on?', 'chair'], ['What do you kick?', 'ball'],
  ['What shines in the day?', 'sun'], ['What do you ride with pedals?', 'bike'], ['What flies in the sky with people inside?', 'airplane'],
];
const BIG_SMALL: [string, string, string, string][] = [
  ['elephant', '🐘', 'mouse', '🐭'], ['whale', '🐋', 'fish', '🐟'], ['truck', '🚚', 'bike', '🚲'], ['tree', '🌳', 'flower', '🌸'],
  ['house', '🏠', 'key', '🔑'], ['bear', '🐻', 'bee', '🐝'],
];
/** Words for rhyming and first sounds, with a picture. */
const RHYMES: [string, string, string][] = [
  ['cat', 'hat', '🧢'], ['dog', 'frog', '🐸'], ['moon', 'spoon', '🥄'], ['bee', 'tree', '🌳'], ['car', 'star', '⭐'],
  ['cake', 'snake', '🐍'], ['goat', 'boat', '⛵'], ['mouse', 'house', '🏠'], ['bear', 'chair', '🪑'], ['fox', 'box', '📦'],
  ['king', 'ring', '💍'], ['bug', 'rug', '🧶'], ['sock', 'clock', '⏰'], ['pig', 'wig', '👱'],
];
const STARTS: { letter: string; word: string; pic: string }[] = [
  { letter: 'b', word: 'ball', pic: '⚽' }, { letter: 'b', word: 'bus', pic: '🚌' }, { letter: 'c', word: 'cat', pic: '🐱' },
  { letter: 'd', word: 'dog', pic: '🐶' }, { letter: 'f', word: 'fish', pic: '🐟' }, { letter: 'g', word: 'goat', pic: '🐐' },
  { letter: 'h', word: 'hat', pic: '🧢' }, { letter: 'm', word: 'moon', pic: '🌙' }, { letter: 'p', word: 'pig', pic: '🐷' },
  { letter: 's', word: 'sun', pic: '☀️' }, { letter: 't', word: 'tree', pic: '🌳' }, { letter: 'r', word: 'rain', pic: '🌧️' },
  { letter: 'l', word: 'lion', pic: '🦁' }, { letter: 'k', word: 'key', pic: '🔑' }, { letter: 'w', word: 'water', pic: '💧' },
  { letter: 'z', word: 'zebra', pic: '🦓' }, { letter: 'a', word: 'apple', pic: '🍎' }, { letter: 'e', word: 'egg', pic: '🥚' },
];

function rhymePicture(r: Rng): Omit<Question, 'skill'> {
  const [word, right, pic] = pick(r, RHYMES);
  const wrong = sample(r, RHYMES.filter((x) => x[0] !== word), 2).map((x) => ({ text: x[1], pic: x[2] }));
  return { prompt: `Which one rhymes with “${word}”?`, why: `${word}, ${right}: they sound the same at the end!`, pictures: true, ...choose(r, { text: right, pic }, wrong) };
}
function firstSound(r: Rng): Omit<Question, 'skill'> {
  const right = pick(r, STARTS);
  const wrong = sample(r, STARTS.filter((s) => s.letter !== right.letter), 2);
  return {
    prompt: `Which one starts with the “${right.letter}” sound?`, say: `Which one starts with the ${right.letter} sound? ${right.letter}, ${right.letter}.`,
    why: `${right.word} starts with ${right.letter.toUpperCase()}.`, pictures: true, ...choose(r, { text: right.word, pic: right.pic }, wrong.map((w) => ({ text: w.word, pic: w.pic }))),
  };
}
function howMany(r: Rng, lo: number, hi: number): Omit<Question, 'skill'> {
  const t = pick(r, THINGS.filter((x) => x.kind === 'animal' || x.kind === 'food'));
  const n = int(r, lo, hi);
  return { prompt: `How many? Count them.`, say: 'How many? Count them with your finger.', show: counted(t.pic, n), why: `There ${n === 1 ? 'is' : 'are'} ${n}.`, ...nums(r, n, [1, -1, 2]) };
}

// ---------- clocks and coins ----------

const clockEmoji = (h: number, half: boolean) => String.fromCodePoint((half ? 0x1F55C : 0x1F550) + ((h + 11) % 12));
const timeText = (h: number, m: number) => `${h}:${String(m).padStart(2, '0')}`;
const COINS = [
  { name: 'penny', many: 'pennies', cents: 1 }, { name: 'nickel', many: 'nickels', cents: 5 },
  { name: 'dime', many: 'dimes', cents: 10 }, { name: 'quarter', many: 'quarters', cents: 25 },
];

// ---------- fractions ----------

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const frac = (n: number, d: number) => `${n}/${d}`;

// ---------- the skills, by level ----------

const S = (level: Level, subject: Subject, id: string, label: string, area: string, make: Skill['make']): Skill => ({ id: `${level}-${id}`, level, subject, label, area, make });

const TALK: Skill[] = [
  S('talk', 'talk', 'find', 'Find the picture', 'Understanding words', (r) => findPicture(r, THINGS)),
  S('talk', 'talk', 'use', 'What is it for?', 'Using words', (r) => {
    const [q, word] = pick(r, USES);
    const right = thing(word);
    return { prompt: q, why: `A ${right.word}! ${right.pic}`, pictures: true, ...choose(r, picOf(right), sample(r, THINGS.filter((t) => t.word !== word && !USES.some((u) => u[1] === t.word && u[0] === q)), 2).map(picOf)) };
  }),
  S('talk', 'talk', 'group', 'Which one goes?', 'Sorting into groups', (r) => {
    const kind = pick(r, ['animal', 'food', 'wear', 'go'] as const);
    const right = pick(r, THINGS.filter((t) => t.kind === kind));
    const wrong = sample(r, THINGS.filter((t) => t.kind !== kind), 2);
    return { prompt: `Which one is ${KIND_NAME[kind]}?`, why: `The ${right.word} is ${KIND_NAME[kind]}.`, pictures: true, ...choose(r, picOf(right), wrong.map(picOf)) };
  }),
  S('talk', 'talk', 'colors', 'Colors', 'Describing words', (r) => {
    const [right, ...wrong] = sample(r, COLORS, 3);
    return { prompt: `Which one is ${right.word}?`, why: `That's ${right.word}!`, pictures: true, ...choose(r, { text: right.word, pic: right.pic }, wrong.map((w) => ({ text: w.word, pic: w.pic }))) };
  }),
  S('talk', 'talk', 'sounds', 'Animal sounds', 'Listening and sounds', (r) => {
    const right = pick(r, SOUNDS);
    const wrong = sample(r, SOUNDS.filter((s) => s.word !== right.word), 2);
    return { prompt: `What does the ${right.word} say?`, show: thing(right.word).pic, why: `The ${right.word} says ${right.sound.toLowerCase()}!`, ...choose(r, txt(right.sound), wrong.map((w) => txt(w.sound))) };
  }),
  S('talk', 'talk', 'bigsmall', 'Big and little', 'Describing words', (r) => {
    const [bw, bp, sw, sp] = pick(r, BIG_SMALL);
    const big = r() < 0.5;
    const right = big ? { text: bw, pic: bp } : { text: sw, pic: sp };
    return { prompt: `Which one is ${big ? 'big' : 'little'}?`, why: `The ${right.text} is ${big ? 'big' : 'little'}.`, pictures: true, ...choose(r, right, [big ? { text: sw, pic: sp } : { text: bw, pic: bp }]) };
  }),
  S('talk', 'talk', 'count', 'Count to 5', 'Number words', (r) => howMany(r, 1, 5)),
];

const PK: Skill[] = [
  S('pk', 'math', 'count', 'Count to 10', 'Number sense', (r) => howMany(r, 1, 10)),
  S('pk', 'math', 'shapes', 'Shapes', 'Shapes', (r) => {
    const [right, ...wrong] = sample(r, SHAPES, 3);
    return { prompt: `Find the ${right.word}.`, why: `That's a ${right.word}.`, pictures: true, ...choose(r, { text: right.word, pic: right.pic }, wrong.map((w) => ({ text: w.word, pic: w.pic }))) };
  }),
  S('pk', 'math', 'more', 'Which has more?', 'Comparing', (r) => {
    const t = pick(r, THINGS.filter((x) => x.kind === 'food'));
    const a = int(r, 1, 5), b = a + int(r, 1, 4);
    return { prompt: 'Which group has more?', why: `${b} is more than ${a}.`, pictures: true, ...choose(r, { text: `${b}`, pic: repeat(t.pic, b) }, [{ text: `${a}`, pic: repeat(t.pic, a) }]) };
  }),
  S('pk', 'reading', 'letters', 'Find the letter', 'Letters', (r) => {
    const [right, ...wrong] = sample(r, 'ABCDEFGHIJKLMNOPRSTW'.split(''), 3);
    return { prompt: `Find the letter ${right}.`, say: `Find the letter ${right}.`, why: `That's ${right}!`, ...choose(r, txt(right), wrong.map(txt)) };
  }),
  S('pk', 'reading', 'rhyme', 'Rhyming', 'Sounds in words', rhymePicture),
  S('pk', 'talk', 'colors', 'Colors', 'Describing words', (r) => TALK.find((s) => s.id === 'talk-colors')!.make(r, { name: '' })),
  S('pk', 'talk', 'use', 'What is it for?', 'Using words', (r) => TALK.find((s) => s.id === 'talk-use')!.make(r, { name: '' })),
];

const K_SIGHT = ['the', 'I', 'a', 'see', 'can', 'we', 'like', 'go', 'to', 'and', 'is', 'my', 'you', 'it', 'up', 'me', 'look', 'in'];
const G1_SIGHT = ['said', 'was', 'they', 'have', 'what', 'there', 'were', 'from', 'when', 'come', 'some', 'could', 'where', 'of', 'once', 'again', 'friend', 'many'];
function sight(r: Rng, words: string[]): Omit<Question, 'skill'> {
  const [right, ...wrong] = sample(r, words, 4);
  return { prompt: `Find the word “${right}”.`, say: `Find the word: ${right}.`, why: `That word is “${right}”.`, ...choose(r, txt(right), wrong.map(txt)) };
}

const K: Skill[] = [
  S('k', 'math', 'count', 'Count to 20', 'Number and number sense', (r) => howMany(r, 5, 20)),
  S('k', 'math', 'next', 'What comes next?', 'Number and number sense', (r) => {
    const n = int(r, 1, 28);
    return { prompt: `What number comes next? ${n}, ${n + 1}, ___`, show: `${n}, ${n + 1}, ?`, why: `After ${n + 1} comes ${n + 2}.`, ...nums(r, n + 2, [1, -1, 10]) };
  }),
  S('k', 'math', 'add', 'Adding to 10', 'Computation', (r) => {
    const t = pick(r, THINGS.filter((x) => x.kind === 'food'));
    const a = int(r, 1, 5), b = int(r, 1, 10 - a);
    return { prompt: `${a} + ${b} = ?`, say: `${a} plus ${b}. How many in all?`, show: `${repeat(t.pic, a)} + ${repeat(t.pic, b)}`, why: `${a} and ${b} more makes ${a + b}.`, ...nums(r, a + b, [1, -1, 2]) };
  }),
  S('k', 'math', 'take', 'Taking away', 'Computation', (r) => {
    const t = pick(r, THINGS.filter((x) => x.kind === 'food'));
    const a = int(r, 3, 10), b = int(r, 1, a - 1);
    return { prompt: `${a} − ${b} = ?`, say: `You have ${a}. You eat ${b}. How many are left?`, show: repeat(t.pic, a), why: `${a} take away ${b} leaves ${a - b}.`, ...nums(r, a - b, [1, -1, 2]) };
  }),
  S('k', 'math', 'shapes', 'Shapes', 'Measurement and geometry', (r) => PK.find((s) => s.id === 'pk-shapes')!.make(r, { name: '' })),
  S('k', 'reading', 'sound', 'First sounds', 'Phonological awareness', firstSound),
  S('k', 'reading', 'rhyme', 'Rhyming', 'Phonological awareness', rhymePicture),
  S('k', 'reading', 'sight', 'Sight words', 'Reading', (r) => sight(r, K_SIGHT)),
  S('k', 'science', 'living', 'Living or not?', 'Living systems', (r) => {
    const living = pick(r, ['🐶 dog', '🌳 tree', '🐟 fish', '🌻 sunflower', '🐝 bee', '🧒 child']);
    const not = sample(r, ['🪨 rock', '⚽ ball', '🚗 car', '🥄 spoon', '🧸 teddy bear', '💧 water'], 2);
    const ch = (s: string): Choice => ({ pic: s.split(' ')[0], text: s.split(' ').slice(1).join(' ') });
    return { prompt: 'Which one is living?', why: 'Living things grow, need food and water, and make more of their kind.', pictures: true, ...choose(r, ch(living), not.map(ch)) };
  }),
];

const G1: Skill[] = [
  S('1', 'math', 'add', 'Adding within 20', 'Computation and estimation', (r) => {
    const a = int(r, 2, 12), b = int(r, 2, 20 - a);
    return { prompt: `${a} + ${b} = ?`, show: `${a} + ${b}`, why: `${a} + ${b} = ${a + b}. Tip: start at ${Math.max(a, b)} and count on ${Math.min(a, b)}.`, ...nums(r, a + b) };
  }),
  S('1', 'math', 'sub', 'Subtracting within 20', 'Computation and estimation', (r) => {
    const a = int(r, 8, 20), b = int(r, 1, a - 1);
    return { prompt: `${a} − ${b} = ?`, show: `${a} − ${b}`, why: `${a} − ${b} = ${a - b}. Check: ${a - b} + ${b} = ${a}.`, ...nums(r, a - b) };
  }),
  S('1', 'math', 'skip', 'Skip counting', 'Patterns', (r) => {
    const by = pick(r, [2, 5, 10]);
    const start = by * int(r, 1, by === 10 ? 8 : 15);
    return { prompt: `Count by ${by}s. What comes next? ${start}, ${start + by}, ${start + 2 * by}, ___`, show: `${start}, ${start + by}, ${start + 2 * by}, ?`, why: `Counting by ${by}s: ${start + 2 * by} + ${by} = ${start + 3 * by}.`, ...nums(r, start + 3 * by, [by, -by, 1, 10]) };
  }),
  S('1', 'math', 'tens', 'Tens and ones', 'Number and number sense', (r) => {
    const t = int(r, 1, 11), o = int(r, 0, 9);
    const n = t * 10 + o;
    if (r() < 0.5) {
      return { prompt: `What number has ${plural(t, 'ten', 'tens')} and ${plural(o, 'one', 'ones')}?`, why: `${t} tens is ${t * 10}, plus ${o} ones is ${n}.`, ...nums(r, n, [1, -1, 10, -10]) };
    }
    const to = (a: number, b: number) => `${plural(a, 'ten', 'tens')}, ${plural(b, 'one', 'ones')}`;
    return { prompt: `How many tens and ones are in ${n}?`, show: String(n), why: `${n} is ${t * 10} + ${o}.`, ...choose(r, txt(to(t, o)), [txt(to(o, t)), txt(to(t, (o + 1) % 10)), txt(to(t + 1, o))]) };
  }),
  S('1', 'math', 'compare', 'Bigger or smaller', 'Number and number sense', (r) => {
    let a = int(r, 10, 119), b = int(r, 10, 119);
    if (a === b) b = a + 1;
    const greater = r() < 0.5;
    const right = greater ? Math.max(a, b) : Math.min(a, b);
    return { prompt: `Which number is ${greater ? 'greater' : 'less'}?`, why: `${Math.max(a, b)} > ${Math.min(a, b)}. Look at the tens first.`, ...choose(r, txt(right), [txt(right === a ? b : a)]) };
  }),
  S('1', 'math', 'coins', 'Counting coins', 'Number and number sense', (r) => {
    const c = pick(r, COINS.slice(0, 3));
    const n = int(r, 2, c.cents === 1 ? 15 : c.cents === 5 ? 9 : 9);
    const v = n * c.cents;
    return { prompt: `How much money is ${n} ${c.many}?`, why: `A ${c.name} is ${c.cents}¢. Count by ${c.cents}s: ${v}¢.`, ...choose(r, txt(`${v}¢`), [v + c.cents, v - c.cents, n, v + 10].filter((x) => x > 0).map((x) => txt(`${x}¢`))) };
  }),
  S('1', 'math', 'clock', 'Telling time', 'Measurement and geometry', (r) => {
    const h = int(r, 1, 12), half = r() < 0.5;
    const right = timeText(h, half ? 30 : 0);
    const wrong = [timeText(h, half ? 0 : 30), timeText(h % 12 + 1, half ? 30 : 0), timeText(((h + 10) % 12) + 1, 0)];
    return { prompt: 'What time is it?', show: clockEmoji(h, half), why: half ? `The long hand is on the 6: half past ${h}, or ${right}.` : `The long hand is on the 12, the short hand on the ${h}: ${right}.`, ...choose(r, txt(right), wrong.map(txt)) };
  }),
  S('1', 'math', 'story', 'Story problems', 'Computation and estimation', (r, c) => {
    const t = pick(r, THINGS.filter((x) => x.kind === 'food' || x.kind === 'animal'));
    const a = int(r, 4, 12), b = int(r, 1, 8);
    const more = r() < 0.5 || b >= a;
    const ans = more ? a + b : a - b;
    const many = t.word.endsWith('s') || t.word === 'fish' || t.word === 'cheese' || t.word === 'milk' ? t.word : `${t.word}s`;
    return {
      prompt: more ? `${c.name} has ${a} ${many}. ${c.name} gets ${b} more. How many now?` : `${c.name} has ${a} ${many}. ${c.name} gives away ${b}. How many are left?`,
      show: t.pic, why: more ? `${a} + ${b} = ${ans}` : `${a} − ${b} = ${ans}`, ...nums(r, ans),
    };
  }),
  S('1', 'math', 'parts', 'Equal parts', 'Number and number sense', bank([
    ['A pizza is cut into 2 equal parts. What is one part called?', 'one half', ['one third', 'one fourth'], 'Two equal parts are halves.', '🍕'],
    ['A sandwich is cut into 4 equal parts. What is one part called?', 'one fourth', ['one half', 'one third'], 'Four equal parts are fourths.', '🥪'],
    ['A cake is cut into 3 equal parts. What is one part called?', 'one third', ['one half', 'one fourth'], 'Three equal parts are thirds.', '🎂'],
    ['How many halves make a whole?', '2', ['3', '4'], 'Two halves make one whole.', '🍎'],
    ['How many fourths make a whole?', '4', ['2', '3'], 'Four fourths make one whole.', '🍪'],
  ])),
  S('1', 'reading', 'vowel', 'Short vowels', 'Foundations: phonics', (r) => {
    const w = pick(r, [['cat', '🐱'], ['dog', '🐶'], ['pig', '🐷'], ['sun', '☀️'], ['bed', '🛏️'], ['hat', '🧢'], ['bus', '🚌'], ['fish', '🐟'], ['egg', '🥚'], ['box', '📦'], ['bug', '🐛'], ['ten', '🔟'], ['map', '🗺️'], ['pin', '📌']] as const);
    const [word, pic] = w;
    const i = word.split('').findIndex((ch) => 'aeiou'.includes(ch));
    const blank = word.slice(0, i) + '_' + word.slice(i + 1);
    return { prompt: `Which vowel finishes the word? ${blank}`, say: `${word}. Which vowel sound is in ${word}?`, show: `${pic}  ${blank}`, why: `${word}: the short ${word[i]} sound.`, ...choose(r, txt(word[i]), 'aeiou'.split('').filter((v) => v !== word[i]).map(txt)) };
  }),
  S('1', 'reading', 'sight', 'Sight words', 'Foundations: word recognition', (r) => sight(r, G1_SIGHT)),
  S('1', 'reading', 'digraph', 'sh, ch, th', 'Foundations: phonics', bank([
    ['Which sound starts “ship”?', 'sh', ['ch', 'th'], 'Ship starts with sh.', '🚢'],
    ['Which sound starts “chick”?', 'ch', ['sh', 'th'], 'Chick starts with ch.', '🐥'],
    ['Which sound starts “thumb”?', 'th', ['sh', 'ch'], 'Thumb starts with th.', '👍'],
    ['Which sound starts “cheese”?', 'ch', ['sh', 'th'], 'Cheese starts with ch.', '🧀'],
    ['Which sound starts “shoe”?', 'sh', ['ch', 'th'], 'Shoe starts with sh.', '👟'],
    ['Which sound ends “fish”?', 'sh', ['ch', 'th'], 'Fish ends with sh.', '🐟'],
    ['Which sound ends “bath”?', 'th', ['sh', 'ch'], 'Bath ends with th.', '🛁'],
    ['Which sound starts “cherry”?', 'ch', ['sh', 'th'], 'Cherry starts with ch.', '🍒'],
    ['Which sound starts “wheel”?', 'wh', ['sh', 'th'], 'Wheel starts with wh.', '🛞'],
  ])),
  S('1', 'reading', 'claps', 'Syllables', 'Foundations: phonological awareness', (r) => {
    const [word, n, pic] = pick(r, [['dog', 1, '🐶'], ['apple', 2, '🍎'], ['rabbit', 2, '🐰'], ['butterfly', 3, '🦋'], ['banana', 3, '🍌'], ['pizza', 2, '🍕'], ['elephant', 3, '🐘'], ['sun', 1, '☀️'], ['tiger', 2, '🐯'], ['watermelon', 4, '🍉'], ['caterpillar', 4, '🐛'], ['tomato', 3, '🍅']] as const);
    return { prompt: `Clap it out! How many syllables in “${word}”?`, say: `Clap it out. How many syllables in ${word}?`, show: pic, why: `${word}: ${n} clap${n === 1 ? '' : 's'}.`, ...choose(r, txt(n), [1, 2, 3, 4].filter((x) => x !== n).map(txt)) };
  }),
  S('1', 'reading', 'rhyme', 'Rhyming words', 'Foundations: phonological awareness', (r) => {
    const [word, right] = pick(r, RHYMES);
    return { prompt: `Which word rhymes with “${word}”?`, why: `${word} and ${right} end with the same sound.`, ...choose(r, txt(right), sample(r, RHYMES.filter((x) => x[0] !== word), 2).map((x) => txt(x[0] === right ? x[1] : x[0]))) };
  }),
  S('1', 'reading', 'opposites', 'Opposites', 'Vocabulary', bank([
    ['What is the opposite of hot?', 'cold', ['warm', 'wet'], 'Hot and cold are opposites.', '🔥'],
    ['What is the opposite of up?', 'down', ['over', 'top'], 'Up and down are opposites.', '⬆️'],
    ['What is the opposite of happy?', 'sad', ['glad', 'silly'], 'Happy and sad are opposites.', '😀'],
    ['What is the opposite of big?', 'little', ['tall', 'huge'], 'Big and little are opposites.', '🐘'],
    ['What is the opposite of fast?', 'slow', ['quick', 'far'], 'Fast and slow are opposites.', '🐇'],
    ['What is the opposite of open?', 'closed', ['wide', 'door'], 'Open and closed are opposites.', '🚪'],
    ['What is the opposite of day?', 'night', ['sun', 'morning'], 'Day and night are opposites.', '☀️'],
    ['What is the opposite of full?', 'empty', ['big', 'heavy'], 'Full and empty are opposites.', '🥛'],
  ])),
  S('1', 'science', 'needs', 'What living things need', 'Living systems', bank([
    ['What do plants need to grow?', 'sun, water and air', ['candy and toys', 'only darkness'], 'Plants need sunlight, water, air, space and nutrients from the soil.', '🌱'],
    ['What do animals need to live?', 'food, water, air and shelter', ['TV and toys', 'only sunlight'], 'Animals need food, water, air and a safe place to live.', '🐻'],
    ['Which part of a plant takes in water from the soil?', 'roots', ['flower', 'leaves'], 'Roots drink water and hold the plant in the ground.', '🌿'],
    ['Which part of a plant makes seeds?', 'flower', ['roots', 'stem'], 'Flowers make seeds that grow new plants.', '🌸'],
  ])),
  S('1', 'science', 'covers', 'Animal coverings', 'Living systems', bank([
    ['What covers a bird\'s body?', 'feathers', ['fur', 'scales'], 'Birds have feathers.', '🐦'],
    ['What covers a fish\'s body?', 'scales', ['feathers', 'fur'], 'Fish have scales.', '🐟'],
    ['What covers a bear\'s body?', 'fur', ['scales', 'feathers'], 'Bears have fur to keep warm.', '🐻'],
    ['What covers a turtle\'s back?', 'a shell', ['feathers', 'fur'], 'Turtles have a hard shell.', '🐢'],
    ['What covers a snake\'s body?', 'scales', ['fur', 'feathers'], 'Snakes have scales.', '🐍'],
  ])),
  S('1', 'science', 'sky', 'Sun and seasons', 'Earth and space', bank([
    ['What gives Earth light and heat?', 'the Sun', ['the Moon', 'clouds'], 'The Sun warms and lights the Earth.', '☀️'],
    ['In which season do many leaves change color and fall?', 'fall', ['spring', 'summer'], 'In fall (autumn) leaves change color and drop.', '🍂'],
    ['Which season is usually the coldest in Virginia?', 'winter', ['summer', 'spring'], 'Winter is the coldest season.', '❄️'],
    ['In which season do many plants start to grow and bloom?', 'spring', ['winter', 'fall'], 'Spring brings new leaves and flowers.', '🌷'],
    ['Why do we have day and night?', 'Earth spins around', ['the Sun turns off', 'clouds cover the Sun'], 'Earth spins once a day, so our side faces the Sun, then away.', '🌍'],
    ['Where does the Sun rise in the morning?', 'in the east', ['in the west', 'in the north'], 'The Sun rises in the east and sets in the west.', '🌅'],
  ])),
  S('1', 'social', 'needs', 'Needs and wants', 'Economics', bank([
    ['Is food a need or a want?', 'need', ['want'], 'We need food to live.', '🍎'],
    ['Is a video game a need or a want?', 'want', ['need'], 'A video game is fun, but we can live without it: a want.', '🎮'],
    ['Is a home (shelter) a need or a want?', 'need', ['want'], 'Everyone needs shelter.', '🏠'],
    ['Is candy a need or a want?', 'want', ['need'], 'Candy is a want.', '🍬'],
    ['Is water a need or a want?', 'need', ['want'], 'We need water to live.', '💧'],
    ['Are warm clothes in winter a need or a want?', 'need', ['want'], 'Clothing is a need.', '🧥'],
  ])),
  S('1', 'social', 'goods', 'Goods and services', 'Economics', bank([
    ['A doctor checks you when you are sick. Is that a good or a service?', 'service', ['good'], 'A service is work someone does for you.', '🩺'],
    ['A farmer grows apples to sell. Are apples goods or services?', 'goods', ['services'], 'Goods are things you can touch and use.', '🍎'],
    ['A barber cuts hair. Is that a good or a service?', 'service', ['good'], 'Cutting hair is work done for you: a service.', '💈'],
    ['A store sells shoes. Are shoes goods or services?', 'goods', ['services'], 'Shoes are things: goods.', '👟'],
    ['A teacher teaches your class. Is that a good or a service?', 'service', ['good'], 'Teaching is a service.', '🍎'],
  ])),
  S('1', 'social', 'map', 'Maps and directions', 'Geography', bank([
    ['On most maps, which way is north?', 'up', ['down', 'left'], 'North is at the top of most maps.', '🧭'],
    ['What do we call the part of a map that explains its symbols?', 'map key (legend)', ['title', 'compass'], 'The map key tells what each symbol means.', '🗺️'],
    ['What is the opposite of north?', 'south', ['east', 'west'], 'North and south are opposites.', '🧭'],
    ['What does a globe show?', 'the whole Earth', ['only your town', 'the Moon'], 'A globe is a model of the Earth.', '🌎'],
    ['What state do we live in?', 'Virginia', ['Texas', 'Florida'], 'Virginia! Its capital is Richmond.', '🏡'],
  ])),
];

const G2: Skill[] = [
  S('2', 'math', 'add', 'Adding two-digit numbers', 'Computation and estimation', (r) => {
    const a = int(r, 12, 75), b = int(r, 11, 99 - a);
    return { prompt: `${a} + ${b} = ?`, show: `${a} + ${b}`, why: `Add tens, then ones: ${a} + ${b} = ${a + b}.`, ...nums(r, a + b) };
  }),
  S('2', 'math', 'sub', 'Subtracting two-digit numbers', 'Computation and estimation', (r) => {
    const a = int(r, 30, 99), b = int(r, 11, a - 5);
    return { prompt: `${a} − ${b} = ?`, show: `${a} − ${b}`, why: `${a} − ${b} = ${a - b}. Check: ${a - b} + ${b} = ${a}.`, ...nums(r, a - b) };
  }),
  S('2', 'math', 'evenodd', 'Even or odd', 'Number and number sense', (r) => {
    const n = int(r, 1, 99);
    return { prompt: `Is ${n} even or odd?`, show: String(n), why: `${n} ends in ${n % 10}, so it is ${n % 2 ? 'odd' : 'even'}. Even numbers end in 0, 2, 4, 6 or 8.`, ...choose(r, txt(n % 2 ? 'odd' : 'even'), [txt(n % 2 ? 'even' : 'odd')]) };
  }),
  S('2', 'math', 'place', 'Hundreds, tens and ones', 'Number and number sense', (r) => {
    const n = int(r, 101, 999);
    const which = pick(r, ['hundreds', 'tens', 'ones'] as const);
    const d = which === 'hundreds' ? Math.floor(n / 100) : which === 'tens' ? Math.floor(n / 10) % 10 : n % 10;
    return { prompt: `What digit is in the ${which} place in ${n}?`, show: String(n), why: `${n} = ${Math.floor(n / 100)} hundreds, ${Math.floor(n / 10) % 10} tens, ${n % 10} ones.`, ...choose(r, txt(d), String(n).split('').filter((x) => x !== String(d)).concat(String((d + 1) % 10)).map(txt)) };
  }),
  S('2', 'math', 'money', 'Counting money', 'Number and number sense', (r) => {
    const q = int(r, 0, 2), d = int(r, 0, 3), n = int(r, 0, 3), p = int(r, 0, 4);
    const v = q * 25 + d * 10 + n * 5 + p || 10;
    const parts = [[q, 'quarter', 'quarters'], [d, 'dime', 'dimes'], [n, 'nickel', 'nickels'], [p, 'penny', 'pennies']].filter(([k]) => k) as [number, string, string][];
    const said = parts.length ? parts.map(([k, one, many]) => plural(k, one, many)).join(', ') : '1 dime';
    return { prompt: `How much is ${said}?`, show: '🪙', why: 'Start with the biggest coins and count on: quarters 25¢, dimes 10¢, nickels 5¢, pennies 1¢.', ...choose(r, txt(`${v}¢`), [v + 5, v - 5, v + 10, v + 1].filter((x) => x > 0).map((x) => txt(`${x}¢`))) };
  }),
  S('2', 'reading', 'contract', 'Contractions', 'Language', bank([
    ['What is the contraction for “do not”?', 'don\'t', ['dont', 'do\'nt'], 'The apostrophe takes the place of the o: don\'t.'],
    ['What is the contraction for “I am”?', 'I\'m', ['Im', 'I\'am'], 'I am → I\'m.'],
    ['What is the contraction for “can not”?', 'can\'t', ['cant', 'ca\'nt'], 'Can not → can\'t.'],
    ['What is the contraction for “it is”?', 'it\'s', ['its', 'it\'is'], 'It is → it\'s (its without the apostrophe means “belongs to it”).'],
    ['What is the contraction for “we will”?', 'we\'ll', ['well', 'we\'will'], 'We will → we\'ll.'],
    ['What is the contraction for “they are”?', 'they\'re', ['there', 'their'], 'They are → they\'re.'],
  ])),
  S('2', 'reading', 'plural', 'More than one', 'Language', bank([
    ['What is the word for more than one box?', 'boxes', ['boxs', 'boxies'], 'Words ending in x add -es.'],
    ['What is the word for more than one baby?', 'babies', ['babys', 'babyes'], 'Change y to i and add -es.'],
    ['What is the word for more than one mouse?', 'mice', ['mouses', 'mouse'], 'Mouse is a special one: mice.'],
    ['What is the word for more than one child?', 'children', ['childs', 'childes'], 'Child → children.'],
    ['What is the word for more than one bus?', 'buses', ['buss', 'bus'], 'Words ending in s add -es.'],
    ['What is the word for more than one tooth?', 'teeth', ['tooths', 'toothes'], 'Tooth → teeth.'],
  ])),
  S('2', 'reading', 'synonym', 'Words that mean the same', 'Vocabulary', bank([
    ['Which word means the same as “big”?', 'large', ['tiny', 'short'], 'Big and large are synonyms.'],
    ['Which word means the same as “glad”?', 'happy', ['angry', 'tired'], 'Glad and happy are synonyms.'],
    ['Which word means the same as “quick”?', 'fast', ['slow', 'late'], 'Quick and fast are synonyms.'],
    ['Which word means the same as “begin”?', 'start', ['stop', 'end'], 'Begin and start are synonyms.'],
    ['Which word means the same as “shout”?', 'yell', ['whisper', 'sing'], 'Shout and yell are synonyms.'],
  ])),
  S('2', 'science', 'cycle', 'Life cycles', 'Living systems', bank([
    ['What does a caterpillar turn into?', 'a butterfly', ['a bee', 'a bird'], 'Egg → caterpillar (larva) → chrysalis (pupa) → butterfly.', '🐛'],
    ['What does a tadpole grow into?', 'a frog', ['a fish', 'a turtle'], 'Egg → tadpole → froglet → frog.', '🐸'],
    ['What comes right after the egg in a butterfly\'s life?', 'caterpillar', ['chrysalis', 'butterfly'], 'The egg hatches into a caterpillar (larva).', '🥚'],
    ['What is a butterfly\'s resting stage called?', 'chrysalis (pupa)', ['tadpole', 'nest'], 'Inside the chrysalis the caterpillar changes into a butterfly.', '🦋'],
  ])),
  S('2', 'science', 'matter', 'Solid, liquid, gas', 'Matter', bank([
    ['Is an ice cube a solid, liquid or gas?', 'solid', ['liquid', 'gas'], 'Ice keeps its own shape: a solid.', '🧊'],
    ['Is milk a solid, liquid or gas?', 'liquid', ['solid', 'gas'], 'Milk takes the shape of its cup: a liquid.', '🥛'],
    ['Is steam from a pot a solid, liquid or gas?', 'gas', ['solid', 'liquid'], 'Steam is water as a gas.', '♨️'],
    ['What happens to ice when it warms up?', 'it melts into water', ['it turns to rock', 'it gets bigger'], 'Heat melts a solid into a liquid.', '🧊'],
    ['A rock is a…', 'solid', ['liquid', 'gas'], 'Rocks keep their shape: solid.', '🪨'],
  ])),
  S('2', 'social', 'world', 'Maps and the world', 'Geography', bank([
    ['How many continents are there?', '7', ['5', '10'], 'Seven continents: North America, South America, Europe, Asia, Africa, Australia and Antarctica.', '🌍'],
    ['Which continent do we live on?', 'North America', ['Europe', 'Africa'], 'The United States is in North America.', '🌎'],
    ['What is the biggest ocean?', 'the Pacific', ['the Atlantic', 'the Indian'], 'The Pacific is the largest ocean.', '🌊'],
    ['Which ocean is on Virginia\'s coast?', 'the Atlantic', ['the Pacific', 'the Arctic'], 'Virginia Beach sits on the Atlantic Ocean.', '🏖️'],
    ['What is the capital of Virginia?', 'Richmond', ['Norfolk', 'Virginia Beach'], 'Richmond is Virginia\'s capital.', '🏛️'],
  ])),
];

const G3: Skill[] = [
  S('3', 'math', 'round', 'Rounding', 'Number and number sense', (r) => {
    const to = pick(r, [10, 100]);
    const n = to === 10 ? int(r, 11, 99) : int(r, 110, 989);
    const ans = Math.round(n / to) * to;
    return { prompt: `Round ${n} to the nearest ${to}.`, show: String(n), why: `${n} is closer to ${ans}${n % to === to / 2 ? ' (5 and up rounds up)' : ''}.`, ...choose(r, txt(ans), [ans - to, ans + to, Math.floor(n / to) * to === ans ? Math.ceil(n / to) * to : Math.floor(n / to) * to].filter((x) => x >= 0).map(txt)) };
  }),
  S('3', 'math', 'times', 'Multiplication', 'Computation and estimation', (r) => {
    const a = int(r, 2, 10), b = int(r, 2, 10);
    return { prompt: `${a} × ${b} = ?`, show: `${a} × ${b}`, why: `${a} groups of ${b} is ${a * b}.`, ...nums(r, a * b, [a, -a, b, -b, 1]) };
  }),
  S('3', 'math', 'threedigit', 'Adding and subtracting to 1,000', 'Computation and estimation', (r) => {
    const add = r() < 0.5;
    const a = int(r, 120, 700), b = int(r, 100, add ? 999 - a : a - 20);
    const ans = add ? a + b : a - b;
    return { prompt: `${a} ${add ? '+' : '−'} ${b} = ?`, show: `${a} ${add ? '+' : '−'} ${b}`, why: `${a} ${add ? '+' : '−'} ${b} = ${ans}. Line up hundreds, tens and ones.`, ...nums(r, ans, [10, -10, 100, -100, 1]) };
  }),
  S('3', 'math', 'fraction', 'Naming fractions', 'Number and number sense', (r) => {
    const d = int(r, 2, 8), n = int(r, 1, d - 1);
    const shown = repeat('🟦', n) + repeat('⬜', d - n);
    return { prompt: 'What fraction of the bar is blue?', show: shown, why: `${n} of ${d} equal parts are blue: ${frac(n, d)}.`, ...choose(r, txt(frac(n, d)), [frac(d - n, d), frac(n, d + 1), frac(d, n)].filter((x) => x !== frac(n, d)).map(txt)) };
  }),
  S('3', 'math', 'perimeter', 'Perimeter', 'Measurement and geometry', (r) => {
    const l = int(r, 3, 12), w = int(r, 2, 9);
    return { prompt: `A rectangle is ${l} cm long and ${w} cm wide. What is its perimeter?`, show: '▭', why: `Add all four sides: ${l} + ${w} + ${l} + ${w} = ${2 * (l + w)} cm.`, ...choose(r, txt(`${2 * (l + w)} cm`), [l * w, l + w, 2 * (l + w) + 2].map((x) => txt(`${x} cm`))) };
  }),
  S('3', 'math', 'elapsed', 'Elapsed time', 'Measurement and geometry', (r) => {
    const h = int(r, 1, 10), m = pick(r, [0, 15, 30]), add = pick(r, [30, 45, 60, 90]);
    const end = h * 60 + m + add;
    const right = timeText(((Math.floor(end / 60) + 11) % 12) + 1, end % 60);
    return { prompt: `Practice starts at ${timeText(h, m)} and lasts ${add >= 60 ? `${plural(Math.floor(add / 60), 'hour', 'hours')}${add % 60 ? ` ${add % 60} minutes` : ''}` : `${add} minutes`}. When does it end?`, show: '⏰', why: `${timeText(h, m)} + ${add} minutes = ${right}.`, ...choose(r, txt(right), [end - 15, end + 15, end + 60].map((t) => txt(timeText(((Math.floor(t / 60) + 11) % 12) + 1, t % 60)))) };
  }),
  S('3', 'reading', 'prefix', 'Prefixes', 'Reading: vocabulary', bank([
    ['What does “unhappy” mean?', 'not happy', ['very happy', 'happy again'], 'un- means not.'],
    ['What does “redo” mean?', 'do again', ['not do', 'do before'], 're- means again.'],
    ['What does “preheat” mean?', 'heat before', ['heat again', 'not heat'], 'pre- means before.'],
    ['What does “unlock” mean?', 'open the lock', ['lock again', 'lock before'], 'un- can mean the opposite of an action.'],
    ['What does “reread” mean?', 'read again', ['not read', 'read before'], 're- means again.'],
  ])),
  S('3', 'reading', 'homophone', 'Homophones', 'Language', bank([
    ['Pick the right word: “I can ___ the bird singing.”', 'hear', ['here'], 'Hear is what your ears do; here is a place.'],
    ['Pick the right word: “We ate ___ apples.”', 'eight', ['ate'], 'Eight is a number.'],
    ['Pick the right word: “The ___ is shining.”', 'sun', ['son'], 'Sun is in the sky; a son is a boy in a family.'],
    ['Pick the right word: “I want ___ cookies.”', 'two', ['to', 'too'], 'Two is the number 2.'],
    ['Pick the right word: “The wind ___ hard.”', 'blew', ['blue'], 'Blew is the past of blow; blue is a color.'],
  ])),
  S('3', 'science', 'water', 'The water cycle', 'Earth systems', bank([
    ['What is it called when water heats up and turns into vapor?', 'evaporation', ['condensation', 'precipitation'], 'Evaporation: liquid water becomes water vapor.', '♨️'],
    ['What is it called when water vapor cools and forms clouds?', 'condensation', ['evaporation', 'precipitation'], 'Condensation: vapor cools into tiny drops.', '☁️'],
    ['Rain, snow, sleet and hail are all…', 'precipitation', ['evaporation', 'condensation'], 'Water falling from clouds is precipitation.', '🌧️'],
    ['What powers the water cycle?', 'the Sun', ['the Moon', 'wind only'], 'The Sun\'s heat drives evaporation.', '☀️'],
  ])),
  S('3', 'science', 'food', 'Food chains', 'Living systems', bank([
    ['In a food chain, where does the energy start?', 'the Sun', ['the hawk', 'the soil'], 'Plants use sunlight to make food; animals eat plants.', '☀️'],
    ['An animal that eats only plants is a…', 'herbivore', ['carnivore', 'omnivore'], 'Herbivores eat plants (like deer).', '🦌'],
    ['An animal that eats only other animals is a…', 'carnivore', ['herbivore', 'producer'], 'Carnivores eat meat (like hawks).', '🦅'],
    ['An animal that eats plants and animals is an…', 'omnivore', ['herbivore', 'producer'], 'Omnivores eat both (like bears and people).', '🐻'],
    ['Grass makes its own food. It is a…', 'producer', ['consumer', 'decomposer'], 'Plants are producers.', '🌱'],
    ['Mushrooms and worms that break down dead things are…', 'decomposers', ['producers', 'carnivores'], 'Decomposers return nutrients to the soil.', '🍄'],
  ])),
];

const G4: Skill[] = [
  S('4', 'math', 'mult', 'Multiplying by one digit', 'Computation and estimation', (r) => {
    const a = int(r, 12, 99), b = int(r, 3, 9);
    return { prompt: `${a} × ${b} = ?`, show: `${a} × ${b}`, why: `Break it apart: ${Math.floor(a / 10) * 10} × ${b} = ${Math.floor(a / 10) * 10 * b}, ${a % 10} × ${b} = ${(a % 10) * b}. Together: ${a * b}.`, ...nums(r, a * b, [10, -10, b, -b, 100]) };
  }),
  S('4', 'math', 'divide', 'Dividing with remainders', 'Computation and estimation', (r) => {
    const b = int(r, 3, 9), q = int(r, 4, 25), rem = int(r, 0, b - 1);
    const a = b * q + rem;
    const say = (qq: number, rr: number) => (rr ? `${qq} R${rr}` : String(qq));
    return { prompt: `${a} ÷ ${b} = ?`, show: `${a} ÷ ${b}`, why: `${b} × ${q} = ${b * q}, and ${rem} left over: ${say(q, rem)}.`, ...choose(r, txt(say(q, rem)), [say(q + 1, rem), say(q, (rem + 1) % b), say(q - 1, rem + b > b - 1 ? rem : rem + b)].map(txt)) };
  }),
  S('4', 'math', 'place', 'Place value to millions', 'Number and number sense', (r) => {
    // A number where the asked-about digit shows up once and isn't 0, so "the 7" points at one place.
    let n = 0, i = 0;
    for (;;) {
      n = int(r, 100000, 9999999);
      const s = String(n);
      const places = [...s].map((d, k) => s.length - 1 - k).filter((k) => k >= 1 && s[s.length - 1 - k] !== '0' && s.split(s[s.length - 1 - k]).length === 2);
      if (places.length) { i = pick(r, places); break; }
    }
    const names = ['ones', 'tens', 'hundreds', 'thousands', 'ten thousands', 'hundred thousands', 'millions'];
    const d = Number(String(n)[String(n).length - 1 - i]);
    const value = d * 10 ** i;
    const f = (x: number) => x.toLocaleString('en-US');
    return { prompt: `What is the value of the ${d} in ${f(n)}?`, show: f(n), why: `The ${d} is in the ${names[i]} place, so it's worth ${f(value)}.`, ...choose(r, txt(f(value)), [value * 10, value / 10, d].filter((x) => Number.isInteger(x) && x !== value).map((x) => txt(f(x)))) };
  }),
  S('4', 'math', 'round', 'Rounding big numbers', 'Number and number sense', (r) => {
    const to = pick(r, [1000, 10000]);
    const n = int(r, to * 2, to * 98);
    const ans = Math.round(n / to) * to;
    const f = (x: number) => x.toLocaleString('en-US');
    return { prompt: `Round ${f(n)} to the nearest ${f(to)}.`, why: `Look at the digit to the right of the ${to === 1000 ? 'thousands' : 'ten thousands'} place: ${f(n)} rounds to ${f(ans)}.`, ...choose(r, txt(f(ans)), [ans + to, ans - to, Math.round(n / (to / 10)) * (to / 10)].filter((x) => x !== ans).map((x) => txt(f(x)))) };
  }),
  S('4', 'math', 'equiv', 'Equivalent fractions', 'Number and number sense', (r) => {
    const d = pick(r, [2, 3, 4, 5, 6]), n = int(r, 1, d - 1), k = int(r, 2, 4);
    const g = gcd(n, d);
    const [nn, dd] = [n / g, d / g];
    return { prompt: `Which fraction is equal to ${frac(nn, dd)}?`, show: frac(nn, dd), why: `Multiply top and bottom by ${k}: ${frac(nn, dd)} = ${frac(nn * k, dd * k)}.`, ...choose(r, txt(frac(nn * k, dd * k)), [frac(nn + k, dd + k), frac(nn * k, dd), frac(nn, dd * k)].map(txt)) };
  }),
  S('4', 'math', 'comparefrac', 'Comparing fractions', 'Number and number sense', (r) => {
    let a = [int(r, 1, 5), 0], b = [int(r, 1, 5), 0];
    a[1] = int(r, a[0] + 1, 8); b[1] = int(r, b[0] + 1, 8);
    if (a[0] * b[1] === b[0] * a[1]) b = [b[0], b[1] + 1];
    const big = a[0] / a[1] > b[0] / b[1] ? a : b;
    return { prompt: `Which is greater: ${frac(a[0], a[1])} or ${frac(b[0], b[1])}?`, why: `Use a common denominator, or picture them: ${frac(big[0], big[1])} is bigger (${(a[0] / a[1]).toFixed(2)} vs ${(b[0] / b[1]).toFixed(2)}).`, ...choose(r, txt(frac(big[0], big[1])), [txt(frac(big === a ? b[0] : a[0], big === a ? b[1] : a[1])), txt('they are equal')]) };
  }),
  S('4', 'math', 'decimal', 'Decimals', 'Number and number sense', (r) => {
    if (r() < 0.5) {
      const n = int(r, 1, 99);
      const d = n < 10 && r() < 0.5 ? 10 : 100;
      const dec = d === 10 ? (n / 10).toFixed(1) : (n / 100).toFixed(2);
      return { prompt: `Write ${frac(n, d)} as a decimal.`, show: frac(n, d), why: `${frac(n, d)} is ${n} ${d === 10 ? 'tenths' : 'hundredths'}: ${dec}.`, ...choose(r, txt(dec), [(n / (d === 10 ? 100 : 10)).toFixed(d === 10 ? 2 : 1), `${n}.0`, (n / 1000).toFixed(3)].filter((x) => x !== dec).map(txt)) };
    }
    const a = int(r, 1, 9) / 10, b = int(r, 10, 99) / 100;
    const big = Math.max(a, b);
    return { prompt: `Which is greater: ${a.toFixed(1)} or ${b.toFixed(2)}?`, why: `Write them with the same places: ${a.toFixed(2)} and ${b.toFixed(2)}. ${big.toFixed(big === a ? 1 : 2)} is greater.`, ...choose(r, txt(big === a ? a.toFixed(1) : b.toFixed(2)), [txt(big === a ? b.toFixed(2) : a.toFixed(1))]) };
  }),
  S('4', 'math', 'area', 'Area and perimeter', 'Measurement and geometry', (r) => {
    const l = int(r, 4, 15), w = int(r, 2, 10);
    const area = r() < 0.5;
    const ans = area ? l * w : 2 * (l + w);
    return { prompt: `A garden is ${l} ft long and ${w} ft wide. What is its ${area ? 'area' : 'perimeter'}?`, show: '🌻▭', why: area ? `Area = length × width = ${l} × ${w} = ${ans} square feet.` : `Perimeter = add all sides = ${l} + ${w} + ${l} + ${w} = ${ans} ft.`, ...choose(r, txt(area ? `${ans} sq ft` : `${ans} ft`), area ? [txt(`${2 * (l + w)} sq ft`), txt(`${l + w} sq ft`), txt(`${ans + l} sq ft`)] : [txt(`${l * w} ft`), txt(`${l + w} ft`), txt(`${ans + 2} ft`)]) };
  }),
  S('4', 'math', 'story', 'Word problems', 'Computation and estimation', (r, c) => {
    const k = int(r, 3, 9), each = int(r, 12, 48);
    const kind = pick(r, [['packs of trading cards', 'cards'], ['boxes of crayons', 'crayons'], ['bags of marbles', 'marbles'], ['rows of chairs', 'chairs']] as const);
    return { prompt: `${c.name} has ${k} ${kind[0]} with ${each} ${kind[1]} in each. How many ${kind[1]} in all?`, why: `${k} × ${each} = ${k * each}.`, ...nums(r, k * each, [each, -each, 10, -10]) };
  }),
  S('4', 'reading', 'affix', 'Prefixes and suffixes', 'Reading: vocabulary', bank([
    ['The prefix “dis-” in “disagree” means…', 'not', ['again', 'before'], 'Disagree means not agree.'],
    ['The prefix “mis-” in “misspell” means…', 'wrongly', ['again', 'before'], 'Misspell means spell wrongly.'],
    ['The suffix “-less” in “fearless” means…', 'without', ['full of', 'again'], 'Fearless means without fear.'],
    ['The suffix “-ful” in “helpful” means…', 'full of', ['without', 'not'], 'Helpful means full of help.'],
    ['The suffix “-able” in “washable” means…', 'can be', ['cannot', 'before'], 'Washable means it can be washed.'],
    ['The prefix “pre-” in “preview” means…', 'before', ['after', 'not'], 'Preview means see before.'],
    ['The suffix “-er” in “teacher” means…', 'a person who', ['not', 'again'], 'A teacher is a person who teaches.'],
  ])),
  S('4', 'reading', 'context', 'Words in context', 'Reading: vocabulary', bank([
    ['“The puppy was so timid that it hid under the bed when guests came.” Timid means…', 'shy', ['brave', 'hungry'], 'Hiding from guests is a clue: shy.'],
    ['“After the long hike, we were famished and ate everything.” Famished means…', 'very hungry', ['very tired', 'very cold'], 'Eating everything is the clue.'],
    ['“The ancient castle was built hundreds of years ago.” Ancient means…', 'very old', ['brand new', 'very tall'], '“Hundreds of years ago” is the clue.'],
    ['“She was elated when she won first prize.” Elated means…', 'very happy', ['very sad', 'confused'], 'Winning first prize makes you very happy.'],
    ['“The path was so narrow only one person could walk on it.” Narrow means…', 'not wide', ['very long', 'muddy'], 'Only one person fits: not wide.'],
    ['“The storm was fierce, with strong winds that knocked down trees.” Fierce means…', 'strong and wild', ['calm', 'short'], 'Knocking down trees shows how strong it was.'],
  ])),
  S('4', 'reading', 'figurative', 'Similes and metaphors', 'Reading: fiction', bank([
    ['“Her smile was as bright as the sun.” This is a…', 'simile', ['metaphor', 'fact'], 'A simile compares using “like” or “as”.'],
    ['“The classroom was a zoo.” This is a…', 'metaphor', ['simile', 'fact'], 'A metaphor says something IS something else.'],
    ['“He ran like the wind.” This is a…', 'simile', ['metaphor', 'fact'], 'It uses “like”, so it\'s a simile.'],
    ['“The wind whispered through the trees.” This gives wind a human action. It is…', 'personification', ['simile', 'a fact'], 'Personification gives human actions to things that aren\'t people.'],
    ['“My brother is a night owl.” What does it mean?', 'he stays up late', ['he is a bird', 'he likes owls'], 'A metaphor: like an owl, he\'s awake at night.'],
  ])),
  S('4', 'reading', 'their', 'There, their, they\'re', 'Writing: usage', bank([
    ['“___ going to the park after school.”', 'They\'re', ['There', 'Their'], 'They\'re = they are.'],
    ['“The kids forgot ___ coats.”', 'their', ['there', 'they\'re'], 'Their shows it belongs to them.'],
    ['“Put the box over ___.”', 'there', ['their', 'they\'re'], 'There is a place.'],
    ['“I want to go ___.”', 'too', ['to', 'two'], 'Too means also.'],
    ['“The dog wagged ___ tail.”', 'its', ['it\'s'], 'Its shows belonging; it\'s = it is.'],
    ['“Is that ___ backpack?”', 'your', ['you\'re'], 'Your shows belonging; you\'re = you are.'],
  ])),
  S('4', 'science', 'moon', 'The Moon', 'Earth and space systems', bank([
    ['Why does the Moon seem to shine?', 'it reflects sunlight', ['it makes its own light', 'it is on fire'], 'The Moon has no light of its own; it reflects the Sun\'s light.', '🌕'],
    ['About how long does the Moon take to go through all its phases?', 'about a month (29½ days)', ['one day', 'one year'], 'New moon to new moon is about 29½ days.', '🌙'],
    ['What phase comes after a new moon?', 'waxing crescent', ['full moon', 'waning crescent'], 'New → waxing crescent → first quarter → waxing gibbous → full.', '🌒'],
    ['When the whole side of the Moon facing us is lit, it\'s a…', 'full moon', ['new moon', 'first quarter'], 'Full moon: the lit side faces Earth.', '🌕'],
    ['What causes the Moon\'s phases?', 'the Moon orbiting Earth', ['clouds covering it', 'Earth\'s shadow every night'], 'As the Moon orbits, we see different amounts of its lit half.', '🌗'],
    ['What object is at the center of our solar system?', 'the Sun', ['Earth', 'the Moon'], 'All the planets orbit the Sun.', '☀️'],
  ])),
  S('4', 'science', 'weather', 'Weather tools', 'Earth and space systems', bank([
    ['Which tool measures air temperature?', 'thermometer', ['barometer', 'anemometer'], 'A thermometer measures temperature.', '🌡️'],
    ['Which tool measures air pressure?', 'barometer', ['thermometer', 'rain gauge'], 'A barometer measures air pressure; falling pressure can mean a storm.', '⛈️'],
    ['Which tool measures wind speed?', 'anemometer', ['barometer', 'thermometer'], 'An anemometer\'s cups spin faster in stronger wind.', '🌬️'],
    ['Which tool measures how much rain fell?', 'rain gauge', ['anemometer', 'barometer'], 'A rain gauge collects and measures rain.', '🌧️'],
    ['What kind of cloud is tall and puffy and can bring thunderstorms?', 'cumulonimbus', ['cirrus', 'stratus'], 'Cumulonimbus clouds are thunderstorm clouds.', '🌩️'],
    ['Thin, wispy clouds high in the sky are…', 'cirrus', ['cumulus', 'stratus'], 'Cirrus clouds are high and feathery.', '☁️'],
  ])),
  S('4', 'science', 'plants', 'Plants', 'Living systems', bank([
    ['What is the process plants use to make food from sunlight?', 'photosynthesis', ['pollination', 'evaporation'], 'Photosynthesis uses sunlight, water and carbon dioxide to make sugar and oxygen.', '🌿'],
    ['What gas do plants give off that we breathe?', 'oxygen', ['carbon dioxide', 'steam'], 'Plants release oxygen during photosynthesis.', '🌳'],
    ['What carries pollen from flower to flower?', 'bees, wind and other animals', ['only rain', 'roots'], 'Pollinators like bees move pollen so seeds can form.', '🐝'],
    ['Which part of the flower makes pollen?', 'stamen', ['pistil', 'root'], 'The stamen is the male part; it makes pollen.', '🌸'],
    ['Where do plants make most of their food?', 'leaves', ['roots', 'flowers'], 'Leaves hold chlorophyll and do photosynthesis.', '🍃'],
  ])),
  S('4', 'science', 'resources', 'Virginia\'s natural resources', 'Earth resources', bank([
    ['Coal in Virginia mostly comes from which part of the state?', 'the southwest mountains', ['the beaches', 'Richmond'], 'Coal is mined in the Appalachian Plateau of southwest Virginia.', '⛏️'],
    ['Which is a renewable resource?', 'trees', ['coal', 'oil'], 'Trees can be replanted; coal and oil take millions of years to form.', '🌲'],
    ['Which is a nonrenewable resource?', 'coal', ['sunlight', 'wind'], 'Once coal is used up, it\'s gone for a very long time.', '🪨'],
    ['Crabs, oysters and fish from the Chesapeake Bay are an important…', 'natural resource', ['factory product', 'mineral'], 'The Bay\'s seafood is one of Virginia\'s natural resources.', '🦀'],
    ['What is the best way to protect the Chesapeake Bay?', 'keep trash and pollution out of the water', ['catch all the crabs', 'cut down trees by the shore'], 'Clean water keeps the Bay healthy for plants and animals.', '🌊'],
  ])),
  S('4', 'social', 'regions', 'Virginia\'s regions', 'Virginia Studies: geography', bank([
    ['Which region of Virginia has the Chesapeake Bay and the beaches?', 'Coastal Plain (Tidewater)', ['Piedmont', 'Blue Ridge Mountains'], 'The Coastal Plain is flat, low land by the Atlantic Ocean and the Bay.', '🏖️'],
    ['Which is the largest region of Virginia?', 'Piedmont', ['Coastal Plain', 'Appalachian Plateau'], 'The Piedmont, with rolling hills, is the biggest region.', '🗺️'],
    ['Which region has Mount Rogers, the highest point in Virginia?', 'Blue Ridge Mountains', ['Piedmont', 'Coastal Plain'], 'Mount Rogers is in the Blue Ridge.', '⛰️'],
    ['The Shenandoah Valley is in which region?', 'Valley and Ridge', ['Coastal Plain', 'Piedmont'], 'The Valley and Ridge has long valleys between mountain ridges.', '🏞️'],
    ['Which region in far southwest Virginia is known for coal?', 'Appalachian Plateau', ['Coastal Plain', 'Piedmont'], 'The Appalachian Plateau has coal mines.', '⛏️'],
    ['What is the line where rivers drop from the Piedmont to the Coastal Plain called?', 'the Fall Line', ['the Coast Line', 'the Equator'], 'At the Fall Line, rivers have waterfalls and rapids, so ships couldn\'t go farther.', '💧'],
    ['How many geographic regions does Virginia have?', '5', ['3', '7'], 'Coastal Plain, Piedmont, Blue Ridge, Valley and Ridge, Appalachian Plateau.', '🗺️'],
    ['Which river flows past Jamestown and Richmond?', 'the James River', ['the Mississippi River', 'the Potomac River'], 'The James River runs through Richmond to the Chesapeake Bay.', '🏞️'],
  ])),
  S('4', 'social', 'history', 'Virginia history', 'Virginia Studies: history', bank([
    ['In what year was Jamestown founded?', '1607', ['1492', '1776'], 'Jamestown, 1607: the first permanent English settlement in North America.', '⛵'],
    ['Which American Indian group lived near Jamestown when the English arrived?', 'the Powhatan', ['the Aztec', 'the Inca'], 'The Powhatan people lived in the Coastal Plain.', '🏹'],
    ['Which crop became Virginia\'s main cash crop in the 1600s?', 'tobacco', ['corn', 'cotton'], 'John Rolfe grew a sweeter tobacco that sold well in England.', '🌿'],
    ['What was the House of Burgesses (1619)?', 'the first elected lawmaking group in the colonies', ['a big house for the governor', 'a fort'], 'It was the first representative legislature in English America.', '🏛️'],
    ['Who said “Give me liberty, or give me death!”?', 'Patrick Henry', ['George Washington', 'John Smith'], 'Patrick Henry gave that speech in Richmond in 1775.', '📜'],
    ['Which Virginian wrote the Declaration of Independence?', 'Thomas Jefferson', ['Patrick Henry', 'James Madison'], 'Thomas Jefferson wrote it in 1776.', '📜'],
    ['Who led the Continental Army in the American Revolution?', 'George Washington', ['Thomas Jefferson', 'Patrick Henry'], 'George Washington, a Virginian, led the army and became the first president.', '🎖️'],
    ['Where did the last major battle of the American Revolution happen (1781)?', 'Yorktown, Virginia', ['Boston', 'Jamestown'], 'The British surrendered at Yorktown.', '⚔️'],
    ['Which Virginian is called the “Father of the Constitution”?', 'James Madison', ['George Washington', 'Patrick Henry'], 'James Madison planned much of the U.S. Constitution.', '📜'],
    ['Virginia\'s capital moved from Jamestown to Williamsburg, then to…', 'Richmond', ['Norfolk', 'Alexandria'], 'Richmond became the capital in 1780 and still is.', '🏛️'],
    ['Where did the Civil War mostly end, in 1865?', 'Appomattox Court House, Virginia', ['Yorktown', 'Jamestown'], 'Robert E. Lee surrendered to Ulysses S. Grant at Appomattox in 1865.', '🕊️'],
    ['Maggie L. Walker of Richmond was the first woman in the U.S. to…', 'start a bank', ['become governor', 'fly a plane'], 'She founded a bank in Richmond in 1903.', '🏦'],
    ['Who was Pocahontas?', 'the daughter of Chief Powhatan', ['an English sailor', 'a Virginia governor'], 'Pocahontas was Powhatan\'s daughter; she later married John Rolfe.', '🪶'],
    ['L. Douglas Wilder of Virginia was the first African American in the U.S. to be…', 'elected governor of a state', ['president', 'an astronaut'], 'He was elected Governor of Virginia in 1989.', '🗳️'],
  ])),
];

const G5: Skill[] = [
  S('5', 'math', 'fracadd', 'Adding fractions', 'Computation and estimation', (r) => {
    const d = pick(r, [4, 5, 6, 8, 10, 12]), a = int(r, 1, d - 2), b = int(r, 1, d - 1 - a);
    return { prompt: `${frac(a, d)} + ${frac(b, d)} = ?`, show: `${frac(a, d)} + ${frac(b, d)}`, why: `Same denominator: add the tops. ${a} + ${b} = ${a + b}, so ${frac(a + b, d)}.`, ...choose(r, txt(frac(a + b, d)), [frac(a + b, d * 2), frac(a + b + 1, d), frac(a * b, d)].map(txt)) };
  }),
  S('5', 'math', 'decadd', 'Adding decimals', 'Computation and estimation', (r) => {
    const a = int(r, 105, 999) / 100, b = int(r, 11, 499) / 100;
    const ans = (Math.round((a + b) * 100) / 100).toFixed(2);
    return { prompt: `${a.toFixed(2)} + ${b.toFixed(2)} = ?`, show: `${a.toFixed(2)} + ${b.toFixed(2)}`, why: `Line up the decimal points: ${ans}.`, ...choose(r, txt(ans), [(a + b + 0.1), (a + b + 1), (a + b - 0.01)].map((x) => txt((Math.round(x * 100) / 100).toFixed(2)))) };
  }),
  S('5', 'math', 'mult2', 'Multiplying two-digit numbers', 'Computation and estimation', (r) => {
    const a = int(r, 12, 49), b = int(r, 11, 29);
    return { prompt: `${a} × ${b} = ?`, show: `${a} × ${b}`, why: `${a} × ${Math.floor(b / 10) * 10} = ${a * Math.floor(b / 10) * 10}, ${a} × ${b % 10} = ${a * (b % 10)}. Add: ${a * b}.`, ...nums(r, a * b, [a, -a, 10, -10, 100]) };
  }),
  S('5', 'math', 'prime', 'Prime or composite', 'Number and number sense', (r) => {
    const n = int(r, 2, 60);
    const isPrime = (x: number) => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return x > 1; };
    const p = isPrime(n);
    const f = [...Array(n).keys()].slice(2).find((i) => n % i === 0);
    return { prompt: `Is ${n} prime or composite?`, show: String(n), why: p ? `${n} only divides by 1 and itself: prime.` : `${n} = ${f} × ${n / f!}: composite.`, ...choose(r, txt(p ? 'prime' : 'composite'), [txt(p ? 'composite' : 'prime')]) };
  }),
  S('5', 'math', 'volume', 'Volume', 'Measurement and geometry', (r) => {
    const l = int(r, 2, 10), w = int(r, 2, 6), h = int(r, 2, 6);
    return { prompt: `A box is ${l} cm long, ${w} cm wide and ${h} cm tall. What is its volume?`, show: '📦', why: `Volume = length × width × height = ${l} × ${w} × ${h} = ${l * w * h} cubic cm.`, ...choose(r, txt(`${l * w * h} cubic cm`), [l + w + h, 2 * (l * w + w * h + l * h), l * w].map((x) => txt(`${x} cubic cm`))) };
  }),
  S('5', 'reading', 'roots', 'Greek and Latin roots', 'Reading: vocabulary', bank([
    ['The root “tele” in telephone and telescope means…', 'far', ['sound', 'small'], 'Tele = far: a telescope sees far away.'],
    ['The root “graph” in autograph means…', 'write', ['see', 'carry'], 'Graph = write: an autograph is writing your own name.'],
    ['The root “port” in transport means…', 'carry', ['write', 'hear'], 'Port = carry: transport carries things across.'],
    ['The root “aud” in audience means…', 'hear', ['see', 'speak'], 'Aud = hear: an audience listens.'],
    ['The root “bio” in biology means…', 'life', ['earth', 'star'], 'Bio = life: biology is the study of living things.'],
    ['The root “geo” in geography means…', 'earth', ['water', 'life'], 'Geo = earth.'],
  ])),
  S('5', 'reading', 'idioms', 'Idioms', 'Reading: fiction', bank([
    ['“It\'s raining cats and dogs.” What does it mean?', 'it\'s raining very hard', ['pets are falling', 'it\'s a little cloudy'], 'An idiom says something you can\'t take word for word.'],
    ['“Break a leg!” before a play means…', 'good luck', ['be careful', 'go home'], 'Actors say it to wish good luck.'],
    ['“That test was a piece of cake.” It was…', 'easy', ['delicious', 'hard'], 'A piece of cake = very easy.'],
    ['“Hold your horses!” means…', 'wait a moment', ['go faster', 'ride a horse'], 'Slow down and wait.'],
    ['“I\'m all ears.” means…', 'I\'m listening', ['I have big ears', 'I can\'t hear'], 'All ears = ready to listen.'],
  ])),
  S('5', 'science', 'rocks', 'Rocks and Earth', 'Earth systems', bank([
    ['Rock that forms when melted rock (magma or lava) cools is…', 'igneous', ['sedimentary', 'metamorphic'], 'Igneous rock comes from cooled magma or lava.', '🌋'],
    ['Rock made from layers of sand, mud and shells pressed together is…', 'sedimentary', ['igneous', 'metamorphic'], 'Sedimentary rock forms in layers and can hold fossils.', '🪨'],
    ['Rock changed by heat and pressure deep underground is…', 'metamorphic', ['igneous', 'sedimentary'], 'Metamorphic means “changed form”.', '💎'],
    ['Where are fossils most often found?', 'in sedimentary rock', ['in igneous rock', 'in lava'], 'Layers of sediment bury and preserve fossils.', '🦴'],
  ])),
  S('5', 'science', 'light', 'Light and sound', 'Force, motion and energy', bank([
    ['Sound is made when something…', 'vibrates', ['glows', 'freezes'], 'Vibrations make sound waves.', '🔔'],
    ['When light bends going from air into water, it\'s called…', 'refraction', ['reflection', 'vibration'], 'Refraction makes a straw look bent in a glass of water.', '🥤'],
    ['When light bounces off a mirror, it\'s called…', 'reflection', ['refraction', 'absorption'], 'Reflection is light bouncing back.', '🪞'],
    ['A prism splits white light into…', 'a rainbow of colors', ['darkness', 'sound'], 'White light is all the colors mixed together.', '🌈'],
    ['Sound travels fastest through…', 'solids', ['air', 'space'], 'Molecules are packed closest in solids; sound can\'t travel in empty space.', '🧱'],
  ])),
];

export const SKILLS: Skill[] = [...TALK, ...PK, ...K, ...G1, ...G2, ...G3, ...G4, ...G5];
export const skillById = (id: string) => SKILLS.find((s) => s.id === id);
export const skillsFor = (level: Level | null, subjectsOff: readonly string[] = []): Skill[] => {
  if (!level) return [];
  const all = SKILLS.filter((s) => s.level === level);
  const on = all.filter((s) => !subjectsOff.includes(s.subject));
  return on.length ? on : all;
};
/** The subjects a level has questions for (so the settings only offer those). */
export const subjectsAt = (level: Level | null): Subject[] => [...new Set(skillsFor(level).map((s) => s.subject))];

/** Makes one question. The same skill and seed always make the same question. */
export function makeQuestion(skillId: string, seed: string, ctx: Ctx): Question | null {
  const s = skillById(skillId);
  if (!s) return null;
  return { skill: s.id, ...s.make(rngFrom(`${skillId}|${seed}`), ctx) };
}

// ---------- the plan a parent sets ----------

export interface LearnPlan { perDay: number; points: number; subjectsOff: Subject[] }
export const DEFAULT_LEARN_PLAN: LearnPlan = { perDay: 6, points: 2, subjectsOff: [] };

export function cleanLearnPlan(raw: unknown, cur: LearnPlan = DEFAULT_LEARN_PLAN): LearnPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LearnPlan, unknown>>;
  const n = (v: unknown, fallback: number, min: number, max: number) => {
    const x = v === undefined ? fallback : Number(v);
    return Number.isInteger(x) ? Math.min(max, Math.max(min, x)) : fallback;
  };
  return {
    perDay: n(r.perDay, cur.perDay, 3, 15), points: n(r.points, cur.points, 0, 100),
    subjectsOff: Array.isArray(r.subjectsOff) ? SUBJECT_IDS.filter((s) => (r.subjectsOff as unknown[]).includes(s)) : cur.subjectsOff,
  };
}

// ---------- picking today's cards ----------

export interface SkillStat { skill: string; right: number; total: number }
export type LearnResult = 'right' | 'second' | 'wrong';

/** How sure we are a kid has a skill: right answers (a second try counts half) over the last few tries. */
export const accuracy = (s: SkillStat | undefined): number | null => (s && s.total ? s.right / s.total : null);
/** A skill counts as got once a kid has answered it 5 times, 80% right. */
export const MASTERED = { min: 5, acc: 0.8 } as const;
export const mastered = (s: SkillStat | undefined): boolean => !!s && s.total >= MASTERED.min && s.right / s.total >= MASTERED.acc;

/**
 * Today's cards: a skill and a seed for each. Subjects take turns so a day isn't all math; within a subject, skills a kid
 * finds hard (or hasn't tried) come up more, and skills they've got come up less (never zero, so they stay fresh).
 * `stats` should be from before today, so the cards don't change while the kid answers them.
 */
export function pickCards(skills: Skill[], stats: SkillStat[], seed: string, count: number): { skill: string; seed: string }[] {
  if (!skills.length) return [];
  const r = rngFrom(seed);
  const by = new Map(stats.map((s) => [s.skill, s]));
  const weight = (s: Skill) => {
    const st = by.get(s.id);
    const acc = accuracy(st);
    if (acc == null) return 2;
    return mastered(st) ? 0.5 : 1 + 2 * (1 - acc);
  };
  const subjects = shuffle(r, [...new Set(skills.map((s) => s.subject))]);
  const used = new Map<string, number>();
  const out: { skill: string; seed: string }[] = [];
  for (let i = 0; i < count; i++) {
    const subject = subjects[i % subjects.length];
    const pool = skills.filter((s) => s.subject === subject);
    // Each skill at most once a round, so a day spreads out.
    const fresh = pool.filter((s) => (used.get(s.id) ?? 0) <= Math.floor(i / skills.length));
    const from = fresh.length ? fresh : pool;
    const total = from.reduce((a, s) => a + weight(s), 0);
    let x = r() * total;
    const s = from.find((k) => (x -= weight(k)) < 0) ?? from[from.length - 1];
    used.set(s.id, (used.get(s.id) ?? 0) + 1);
    out.push({ skill: s.id, seed: `${seed}#${i}` });
  }
  return out;
}
