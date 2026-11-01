// Built-in choices shared by the server (to validate) and the app (to show).

/** Avatars are an animal friend wearing an outfit. Drawn in web/src/components/Raccoon.tsx. */
export const ANIMALS = ['raccoon', 'fox', 'panda', 'bunny', 'cat', 'bear', 'puppy', 'koala', 'tiger'] as const;
export type Animal = (typeof ANIMALS)[number];

export const ANIMAL_LABELS: Record<Animal, string> = {
  raccoon: 'Raccoon', fox: 'Fox', panda: 'Panda', bunny: 'Bunny', cat: 'Kitty', bear: 'Bear', puppy: 'Puppy', koala: 'Koala', tiger: 'Tiger',
};

/** Outfits any animal can wear. 'classic' is no outfit. */
export const OUTFITS = [
  'classic', 'ninja', 'bandana', 'glasses', 'cap', 'crown', 'bow', 'headphones',
  'party', 'pirate', 'wizard', 'astronaut', 'superhero', 'golden',
] as const;
export type Outfit = (typeof OUTFITS)[number];

export const OUTFIT_LABELS: Record<Outfit, string> = {
  classic: 'Classic', ninja: 'Ninja', bandana: 'Bandit', glasses: 'Professor',
  cap: 'Sporty', crown: 'Royal', bow: 'Fancy', headphones: 'DJ',
  party: 'Party', pirate: 'Pirate', wizard: 'Wizard', astronaut: 'Astronaut', superhero: 'Superhero', golden: 'Golden Legend',
};

/** Level a kid needs before they can pick an outfit themselves (parents can always pick any). Every animal is open. */
export const OUTFIT_UNLOCK_LEVEL: Partial<Record<Outfit, number>> = {
  party: 2, pirate: 3, wizard: 4, astronaut: 5, superhero: 6, golden: 7,
};

/**
 * An avatar id: "fox-wizard", or "fox" for a fox in no outfit. A raccoon is just its outfit ("wizard", "classic"),
 * which is how avatars were stored before there were other animals, so existing picks keep working.
 */
export type Avatar = string;

export function avatarId(animal: Animal, outfit: Outfit): Avatar {
  if (animal === 'raccoon') return outfit;
  return outfit === 'classic' ? animal : `${animal}-${outfit}`;
}

export function parseAvatar(v: unknown): { animal: Animal; outfit: Outfit } | null {
  if (typeof v !== 'string') return null;
  if ((OUTFITS as readonly string[]).includes(v)) return { animal: 'raccoon', outfit: v as Outfit };
  const [animal, outfit = 'classic', ...rest] = v.split('-');
  if (rest.length || !(ANIMALS as readonly string[]).includes(animal) || !(OUTFITS as readonly string[]).includes(outfit)) return null;
  return { animal: animal as Animal, outfit: outfit as Outfit };
}

export function isAvatar(v: unknown): v is Avatar {
  const p = parseAvatar(v);
  return p !== null && avatarId(p.animal, p.outfit) === v;
}

export function avatarLabel(v: Avatar): string {
  const p = parseAvatar(v) ?? { animal: 'raccoon', outfit: 'classic' };
  return p.outfit === 'classic' ? ANIMAL_LABELS[p.animal] : `${OUTFIT_LABELS[p.outfit]} ${ANIMAL_LABELS[p.animal].toLowerCase()}`;
}

export const outfitUnlocked = (outfit: Outfit, level: number): boolean => level >= (OUTFIT_UNLOCK_LEVEL[outfit] ?? 1);
export const avatarUnlocked = (avatar: Avatar, level: number): boolean => outfitUnlocked(parseAvatar(avatar)?.outfit ?? 'classic', level);

/** Starting avatars for new kids, so siblings don't all begin as the same animal. */
export const defaultAvatar = (n: number): Avatar => avatarId(ANIMALS[n % ANIMALS.length], 'classic');

/** Cheers a parent can send with an approval. */
export const CHEERS = [
  { id: 'star', icon: '🌟', text: 'Superstar!' },
  { id: 'highfive', icon: '🙌', text: 'High five!' },
  { id: 'strong', icon: '💪', text: 'So strong!' },
  { id: 'champ', icon: '🏆', text: 'Champion!' },
  { id: 'love', icon: '❤️', text: 'Love it!' },
  { id: 'wow', icon: '🤩', text: 'Wow!' },
] as const;
export type CheerId = (typeof CHEERS)[number]['id'];
export const isCheer = (v: unknown): v is CheerId => CHEERS.some((c) => c.id === v);

/** Card colors for kids, picked to stay readable with white text. */
// They double as chart series colors, so the set is checked for color-blind separation and contrast on both light and
// dark surfaces. Dark themes draw charts with the matching KID_COLORS_DARK step.
export const KID_COLORS = ['#2f9e6e', '#1f6fb2', '#8e2c7a', '#d9480f', '#5f3dc4', '#c2255c', '#1098ad', '#b86e00'] as const;
export const KID_COLORS_DARK = ['#30a874', '#4d94d9', '#d0589f', '#e0652f', '#9a7cf2', '#e8558a', '#22a0b8', '#b88010'] as const;
/** Colors from earlier versions, still accepted and mapped to their replacement's slot. */
const LEGACY_KID_COLORS: Record<string, number> = { '#0b7285': 6, '#e67700': 7 };

export const isKidColor = (v: unknown): v is string =>
  typeof v === 'string' && ((KID_COLORS as readonly string[]).includes(v) || v in LEGACY_KID_COLORS);

/** The color to draw a kid's chart series with on a light or dark theme. */
export function seriesColor(color: string, dark: boolean): string {
  const i = (KID_COLORS as readonly string[]).indexOf(color);
  const slot = i >= 0 ? i : LEGACY_KID_COLORS[color];
  if (slot == null) return color;
  return dark ? KID_COLORS_DARK[slot] : KID_COLORS[slot];
}

/** Suggested chore icons. Any single emoji is accepted. */
export const CHORE_ICONS = [
  '🛏️', '🦷', '🧹', '🍽️', '🧺', '🐶', '🐱', '🌱', '📚', '🗑️', '🧸', '🚿', '🎹', '👕', '🥪', '🧽', '🚗', '🍂', '📖', '⭐',
] as const;

/** Icons for the home's points currency. */
export const POINT_ICONS = ['✨', '⭐', '🪙', '💎', '🍪', '🌰', '🐚', '🏅'] as const;

/** Ready-made chores for a kid's room (a raccoon's den), in the chore editor's Room category. */
export const ROOM_TEMPLATES = [
  { title: 'Make your bed', icon: '🛏️' },
  { title: 'Toys away', icon: '🧸' },
  { title: 'Laundry in the hamper', icon: '🧺' },
  { title: 'Books on the shelf', icon: '📚' },
  { title: 'Shoes in the closet', icon: '👟' },
  { title: 'Clear the floor', icon: '🧹' },
  { title: 'Tidy the desk', icon: '✏️' },
  { title: 'Open the curtains', icon: '🪟' },
  { title: 'Cups back to the kitchen', icon: '🥤' },
  { title: 'Trash in the bin', icon: '🗑️' },
  { title: 'Water your plant', icon: '🌱' },
  { title: 'Lights off when you leave', icon: '💡' },
] as const;

// ---------- routines ----------
/** Ordered checklists kids run through at set times of day, one step at a time with a timer. */
export const ROUTINES = [
  { id: 'morning', title: 'Morning routine', icon: '🌅' },
  { id: 'afterschool', title: 'After school', icon: '🎒' },
  { id: 'bedtime', title: 'Bedtime routine', icon: '🌙' },
] as const;
export type RoutineId = (typeof ROUTINES)[number]['id'];
export const ROUTINE_IDS: RoutineId[] = ROUTINES.map((r) => r.id);
export const routineOf = (id: string | null | undefined) => ROUTINES.find((r) => r.id === id) ?? null;

/** Ready-made steps for each routine, with a timer in minutes. */
export const ROUTINE_TEMPLATES: Record<RoutineId, { title: string; icon: string; minutes: number }[]> = {
  morning: [
    { title: 'Get dressed', icon: '👕', minutes: 5 },
    { title: 'Make your bed', icon: '🛏️', minutes: 3 },
    { title: 'Eat breakfast', icon: '🥣', minutes: 15 },
    { title: 'Brush your teeth', icon: '🪥', minutes: 2 },
    { title: 'Pack your backpack', icon: '🎒', minutes: 3 },
  ],
  afterschool: [
    { title: 'Unpack your backpack', icon: '🎒', minutes: 3 },
    { title: 'Have a snack', icon: '🍎', minutes: 10 },
    { title: 'Homework', icon: '📚', minutes: 20 },
    { title: 'Read for 20 minutes', icon: '📖', minutes: 20 },
  ],
  bedtime: [
    { title: 'Tidy your toys', icon: '🧸', minutes: 5 },
    { title: 'Bath or shower', icon: '🛁', minutes: 10 },
    { title: 'Pajamas on', icon: '🩳', minutes: 3 },
    { title: 'Brush your teeth', icon: '🪥', minutes: 2 },
    { title: 'Pick tomorrow\'s clothes', icon: '👟', minutes: 3 },
  ],
};
