// Math facts helper: multiplication and division facts, shown several different ways (groups, arrays, hops on a number
// line, breaking a fact apart, fact families, a story, a memory trick), and remembered with gentle spaced review: a fact
// a kid gets right comes back after longer and longer gaps; one they miss comes back tomorrow. No timers.

export type Op = 'x' | '/';
/** For 'x' it's a × b. For '/' it's a ÷ b, with a the bigger number (24 ÷ 6). */
export interface Fact { op: Op; a: number; b: number }

export const MAX_TABLE = 12;
export const factKey = (f: Fact): string => `${f.a}${f.op}${f.b}`;
export function parseFact(key: unknown): Fact | null {
  const m = /^(\d{1,3})([x/])(\d{1,2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const f: Fact = { a: Number(m[1]), op: m[2] as Op, b: Number(m[3]) };
  if (f.op === 'x') return f.a <= MAX_TABLE && f.b <= MAX_TABLE ? f : null;
  return f.b >= 1 && f.b <= MAX_TABLE && f.a % f.b === 0 && f.a / f.b <= MAX_TABLE ? f : null;
}
export const answerOf = (f: Fact): number => (f.op === 'x' ? f.a * f.b : f.a / f.b);
export const factText = (f: Fact): string => (f.op === 'x' ? `${f.a} × ${f.b}` : `${f.a} ÷ ${f.b}`);
/** The two factors and the product: 24 ÷ 6 → 6, 4, 24. */
export function familyOf(f: Fact): { x: number; y: number; product: number } {
  return f.op === 'x' ? { x: f.a, y: f.b, product: f.a * f.b } : { x: f.b, y: f.a / f.b, product: f.a };
}
/** The four sentences in a fact family (just two when both factors are the same). */
export function familySentences(f: Fact): string[] {
  const { x, y, product } = familyOf(f);
  const out = [`${x} × ${y} = ${product}`, `${y} × ${x} = ${product}`];
  if (x) out.push(`${product} ÷ ${x} = ${y}`);
  if (y) out.push(`${product} ÷ ${y} = ${x}`);
  return [...new Set(out)];
}

/** Every fact in the tables a parent picked (1 to 10 of each, or to 12 when the plan goes that high). */
export function factsFor(tables: number[], ops: Op[], upTo = 10): Fact[] {
  const out: Fact[] = [];
  for (const t of tables) {
    for (let n = 1; n <= upTo; n++) {
      if (ops.includes('x')) out.push({ op: 'x', a: t, b: n });
      if (ops.includes('/') && t > 0) out.push({ op: '/', a: t * n, b: t });
    }
  }
  return out;
}

// ---------- the plan a parent sets ----------

export interface MathPlan { tables: number[]; ops: Op[]; upTo: 10 | 12; perDay: number; points: number }
export const DEFAULT_PLAN: MathPlan = { tables: [2, 3, 4, 5, 6, 7, 8, 9], ops: ['x', '/'], upTo: 10, perDay: 8, points: 2 };

export function cleanPlan(raw: unknown, cur: MathPlan = DEFAULT_PLAN): MathPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof MathPlan, unknown>>;
  const tables = Array.isArray(r.tables)
    ? [...new Set(r.tables.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= MAX_TABLE))].sort((a, b) => a - b)
    : cur.tables;
  const ops = Array.isArray(r.ops) ? (['x', '/'] as Op[]).filter((o) => (r.ops as unknown[]).includes(o)) : cur.ops;
  const upTo = r.upTo === undefined ? cur.upTo : Number(r.upTo) === 12 ? 12 : 10;
  const int = (v: unknown, fallback: number, min: number, max: number) => {
    const n = v === undefined ? fallback : Number(v);
    return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    tables: tables.length ? tables : cur.tables, ops: ops.length ? ops : cur.ops, upTo,
    perDay: int(r.perDay, cur.perDay, 3, 20), points: int(r.points, cur.points, 0, 100),
  };
}

// ---------- remembering: spaced review ----------

/** Days until a fact comes back, by box. Box 0 is new or missed; box 4 and up counts as remembered. */
export const BOX_DAYS = [0, 1, 3, 7, 14, 30] as const;
export const REMEMBERED_BOX = 4;
export type Recall = 'right' | 'hint' | 'wrong';

/** Right moves a fact up a box; right with a hint keeps it where it is; a miss starts it over. */
export function nextBox(box: number, r: Recall): number {
  if (r === 'right') return Math.min(box + 1, BOX_DAYS.length - 1);
  if (r === 'hint') return Math.max(box, 0);
  return 0;
}
export function nextDue(today: string, box: number, r: Recall): string {
  // Anything not a clean "right" comes back tomorrow, so it's fresh without being nagged about the same day.
  const days = r === 'right' ? BOX_DAYS[box] : 1;
  return new Date(Date.parse(`${today}T00:00:00Z`) + Math.max(days, 1) * 864e5).toISOString().slice(0, 10);
}

export interface FactState { fact: string; box: number; due: string; right: number; wrong: number }

/**
 * Today's cards: facts that are due (lowest box first, so the shakiest come up), then a few new ones from the plan in
 * order. A kid never gets more than `perDay`, and at most 4 brand-new facts a day. `room` is what's left of today's
 * allowance once some cards were answered.
 */
export function pickReview(plan: MathPlan, states: FactState[], today: string, room: { cards?: number; fresh?: number } = {}): Fact[] {
  const inPlan = factsFor(plan.tables, plan.ops, plan.upTo);
  const byKey = new Map(states.map((s) => [s.fact, s]));
  const due = inPlan.filter((f) => { const s = byKey.get(factKey(f)); return s && s.due <= today; })
    .sort((p, q) => byKey.get(factKey(p))!.box - byKey.get(factKey(q))!.box || byKey.get(factKey(p))!.due.localeCompare(byKey.get(factKey(q))!.due));
  const fresh = inPlan.filter((f) => !byKey.has(factKey(f)) && f.a !== 0 && !(f.op === 'x' && (f.a <= 1 || f.b <= 1)));
  // Mix the tables so new cards aren't all "6 × 1, 6 × 2, 6 × 3".
  const mixed = [...fresh].sort((p, q) => hash(factKey(p) + today) - hash(factKey(q) + today));
  return [...due, ...mixed.slice(0, Math.max(0, room.fresh ?? 4))].slice(0, Math.max(0, room.cards ?? plan.perDay));
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- memory tricks ----------

/** Little rhymes for the facts kids find hardest to remember. Keyed by the smaller factor first. */
export const RHYMES: Record<string, string> = {
  '3x4': '1, 2, 3, 4: 12 = 3 × 4. The numbers count in order!',
  '3x8': '3 × 8 is 24: shut the door!',
  '4x6': '4 × 6 is 24: knock on the door, then knock some more.',
  '4x8': '4 × 8 is 32: shut the door, you got the flu!',
  '6x6': '6 × 6 is 36: pick up sticks!',
  '6x7': '6 × 7 is 42: the answer is 42, like a secret code.',
  '6x8': '6 and 8 went on a date. They didn\'t get home till 48!',
  '6x9': '6 × 9 is 54: the 9s trick works. 5 + 4 = 9.',
  '7x7': '7 and 7 went to dine, they came back at 49.',
  '7x8': '5, 6, 7, 8: 56 = 7 × 8. The numbers count in order!',
  '8x8': '8 × 8, I fell on the floor. Picked myself up: 64!',
  '4x7': '4 × 7 is 28: a whole month of days in February!',
  '12x12': '12 × 12 is 144: a gross, which is a funny name for a big number.',
};

export interface Trick { icon: string; title: string; lines: string[] }

/**
 * How to remember a fact: the easiest strategy for it (×2 is doubling, ×5 is half of ×10, the 9s finger trick…),
 * a rhyme for the hard ones, and "you already know the turn-around".
 */
export function trickFor(f: Fact): Trick[] {
  const { x, y, product } = familyOf(f);
  const out: Trick[] = [];
  if (f.op === '/') {
    out.push({ icon: '🔁', title: 'Think times', lines: [`${f.a} ÷ ${f.b} asks: ${f.b} × what = ${f.a}?`, `${f.b} × ${y} = ${product}, so ${f.a} ÷ ${f.b} = ${y}.`] });
  }
  const lo = Math.min(x, y), hi = Math.max(x, y);
  const rhyme = RHYMES[`${lo}x${hi}`];
  if (rhyme) out.push({ icon: '🎵', title: 'Say it like a rhyme', lines: [rhyme] });
  // Use the factor with the friendliest strategy.
  const order = [0, 1, 10, 2, 5, 11, 9, 4, 3, 6, 8, 12, 7];
  const easy = order.find((n) => n === x || n === y) ?? lo;
  const other = easy === x ? y : x;
  const s = strategy(easy, other);
  if (s) out.push(s);
  if (x !== y && x > y && f.op === 'x') out.push({ icon: '🔄', title: 'Turn it around', lines: [`${x} × ${y} is the same as ${y} × ${x}. If you know one, you know both!`] });
  return out;
}

function strategy(n: number, m: number): Trick | null {
  const p = n * m;
  switch (n) {
    case 0: return { icon: '🕳️', title: 'Zero is nothing', lines: [`${m} groups of nothing is nothing. Anything × 0 = 0.`] };
    case 1: return { icon: '☝️', title: 'One group', lines: [`1 group of ${m} is just ${m}. × 1 keeps it the same.`] };
    case 2: return { icon: '👯', title: 'Doubles', lines: [`× 2 means double it: ${m} + ${m} = ${p}.`] };
    case 10: return { icon: '🔟', title: 'Tens', lines: [`× 10: put a 0 on the end. ${m} → ${p}.`] };
    case 5: return { icon: '🖐️', title: 'Half of ten', lines: [`${m} × 10 = ${m * 10}. Half of that is ${p}.`, 'Fives always end in 0 or 5, like a clock: 5, 10, 15, 20…'] };
    case 11: return m <= 9 ? { icon: '🪞', title: 'Mirror digits', lines: [`11 × ${m}: write ${m} twice → ${p}.`] } : { icon: '➕', title: 'Ten and one more', lines: [`10 × ${m} = ${m * 10}, plus one more ${m} = ${p}.`] };
    case 9: return m <= 10 ? {
      icon: '🙌', title: 'The 9s finger trick',
      lines: [`Hold up 10 fingers. Fold down finger number ${m}.`, `Fingers before it: ${Math.floor(p / 10)} (tens). Fingers after it: ${p % 10} (ones). That's ${p}!`,
        `Check: ${Math.floor(p / 10)} + ${p % 10} = 9. The digits of the 9s always add up to 9.`],
    } : { icon: '➖', title: 'Ten minus one', lines: [`10 × ${m} = ${m * 10}, take away one ${m}: ${p}.`] };
    case 4: return { icon: '👯', title: 'Double, then double again', lines: [`${m} doubled is ${m * 2}. Double again: ${p}.`] };
    case 3: return { icon: '➕', title: 'Double plus one more', lines: [`${m} doubled is ${m * 2}. One more ${m}: ${m * 2} + ${m} = ${p}.`] };
    case 6: return { icon: '🖐️', title: 'Fives plus one more', lines: [`5 × ${m} = ${5 * m}. One more ${m}: ${5 * m} + ${m} = ${p}.`] };
    case 8: return { icon: '👯', title: 'Double three times', lines: [`${m} → ${m * 2} → ${m * 4} → ${p}. Double, double, double!`] };
    case 12: return { icon: '➕', title: 'Ten and two', lines: [`10 × ${m} = ${m * 10}, 2 × ${m} = ${m * 2}. Together: ${p}.`] };
    case 7: return { icon: '🧩', title: 'Fives and twos', lines: [`5 × ${m} = ${5 * m} and 2 × ${m} = ${2 * m}. Together: ${p}.`] };
    default: return null;
  }
}

// ---------- break it apart ----------

/** The friendliest way to split the bigger factor: 7 × 6 = 5 × 6 + 2 × 6; 9 × 6 = 10 × 6 − 1 × 6. */
export function splitFor(f: Fact): { big: number; small: number; parts: [number, number]; minus: boolean } {
  const { x, y } = familyOf(f);
  const big = Math.max(x, y), small = Math.min(x, y);
  if (big === 9) return { big, small, parts: [10, 1], minus: true };
  if (big > 5 && big <= 10) return { big, small, parts: [5, big - 5], minus: false };
  if (big > 10) return { big, small, parts: [10, big - 10], minus: false };
  if (big >= 3) return { big, small, parts: [2, big - 2], minus: false };
  return { big, small, parts: [big, 0], minus: false };
}

// ---------- stories ----------

const THINGS = [
  { one: 'acorn', many: 'acorns', icon: '🌰', box: 'bag', boxes: 'bags' },
  { one: 'cookie', many: 'cookies', icon: '🍪', box: 'plate', boxes: 'plates' },
  { one: 'sticker', many: 'stickers', icon: '⭐', box: 'page', boxes: 'pages' },
  { one: 'apple', many: 'apples', icon: '🍎', box: 'basket', boxes: 'baskets' },
  { one: 'egg', many: 'eggs', icon: '🥚', box: 'nest', boxes: 'nests' },
  { one: 'wheel', many: 'wheels', icon: '🛞', box: 'car', boxes: 'cars' },
  { one: 'crayon', many: 'crayons', icon: '🖍️', box: 'box', boxes: 'boxes' },
  { one: 'fish', many: 'fish', icon: '🐟', box: 'tank', boxes: 'tanks' },
] as const;
export type Thing = (typeof THINGS)[number];
export const thingFor = (f: Fact, salt = ''): Thing => THINGS[hash(factKey(f) + salt) % THINGS.length];

export function storyFor(f: Fact, name: string, salt = ''): { thing: Thing; text: string; question: string; answer: string } {
  const t = thingFor(f, salt);
  const { x, y, product } = familyOf(f);
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (f.op === 'x') {
    return {
      thing: t, text: `${name} has ${n(x, t.box, t.boxes)}. Each ${t.box} has ${n(y, t.one, t.many)} in it.`,
      question: `How many ${t.many} is that in all?`, answer: `${x} groups of ${y} is ${x} × ${y} = ${product} ${t.many}.`,
    };
  }
  // Two kinds of dividing: sharing out equally, or making groups of a size. Take turns between them.
  return hash(factKey(f) + salt) % 2
    ? {
      thing: t, text: `${name} has ${product} ${t.many} to share equally into ${n(f.b, t.box, t.boxes)}.`,
      question: `How many ${t.many} go in each ${t.box}?`, answer: `${product} shared into ${f.b} is ${product} ÷ ${f.b} = ${y} in each ${t.box}.`,
    }
    : {
      thing: t, text: `${name} has ${product} ${t.many} and puts ${f.b} in each ${t.box}.`,
      question: `How many ${t.boxes} does ${name} fill?`, answer: `${product} in groups of ${f.b} is ${product} ÷ ${f.b} = ${y} ${t.boxes}.`,
    };
}

/** The ways a fact can be shown, in the order the helper offers them. */
export const WAYS = [
  { id: 'trick', icon: '🧠', label: 'Memory trick' },
  { id: 'groups', icon: '🍪', label: 'Groups' },
  { id: 'array', icon: '🟦', label: 'Array' },
  { id: 'hops', icon: '🐸', label: 'Hops' },
  { id: 'split', icon: '🧩', label: 'Break it apart' },
  { id: 'family', icon: '🔺', label: 'Fact family' },
  { id: 'story', icon: '📖', label: 'Story' },
  { id: 'ask', icon: '🦝', label: 'Ask Rocky' },
] as const;
export type Way = (typeof WAYS)[number]['id'];
export const WAY_IDS = WAYS.map((w) => w.id) as Way[];
