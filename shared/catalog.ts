// Built-in choices shared by the server (to validate) and the app (to show).

/** Raccoon avatars. Drawn in web/src/components/Raccoon.tsx. */
export const AVATARS = [
  'classic', 'ninja', 'bandana', 'glasses', 'cap', 'crown', 'bow', 'headphones',
  'party', 'pirate', 'wizard', 'astronaut', 'superhero', 'golden',
] as const;
export type Avatar = (typeof AVATARS)[number];

export const AVATAR_LABELS: Record<Avatar, string> = {
  classic: 'Classic', ninja: 'Ninja', bandana: 'Bandit', glasses: 'Professor',
  cap: 'Sporty', crown: 'Royal', bow: 'Fancy', headphones: 'DJ',
  party: 'Party', pirate: 'Pirate', wizard: 'Wizard', astronaut: 'Astronaut', superhero: 'Superhero', golden: 'Golden Legend',
};

/** Raccoon level a kid needs before they can pick an avatar themselves (parents can always pick any). */
export const AVATAR_UNLOCK_LEVEL: Partial<Record<Avatar, number>> = {
  party: 2, pirate: 3, wizard: 4, astronaut: 5, superhero: 6, golden: 7,
};

export const avatarUnlocked = (avatar: Avatar, level: number): boolean => level >= (AVATAR_UNLOCK_LEVEL[avatar] ?? 1);

export const isAvatar = (v: unknown): v is Avatar => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

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
