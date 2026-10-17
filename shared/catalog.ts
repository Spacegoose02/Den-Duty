// Built-in choices shared by the server (to validate) and the app (to show).

/** Raccoon avatars. Drawn in web/src/components/Raccoon.tsx. */
export const AVATARS = ['classic', 'ninja', 'bandana', 'glasses', 'cap', 'crown', 'bow', 'headphones'] as const;
export type Avatar = (typeof AVATARS)[number];

export const AVATAR_LABELS: Record<Avatar, string> = {
  classic: 'Classic', ninja: 'Ninja', bandana: 'Bandit', glasses: 'Professor',
  cap: 'Sporty', crown: 'Royal', bow: 'Fancy', headphones: 'DJ',
};

export const isAvatar = (v: unknown): v is Avatar => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

/** Card colors for kids, picked to stay readable with white text. */
export const KID_COLORS = ['#2f9e6e', '#1f6fb2', '#8e2c7a', '#d9480f', '#5f3dc4', '#c2255c', '#0b7285', '#e67700'] as const;

export const isKidColor = (v: unknown): v is string => typeof v === 'string' && (KID_COLORS as readonly string[]).includes(v);

/** Suggested chore icons. Any single emoji is accepted. */
export const CHORE_ICONS = [
  '🛏️', '🦷', '🧹', '🍽️', '🧺', '🐶', '🐱', '🌱', '📚', '🗑️', '🧸', '🚿', '🎹', '👕', '🥪', '🧽', '🚗', '🍂', '📖', '⭐',
] as const;

/** Icons for the home's points currency. */
export const POINT_ICONS = ['✨', '⭐', '🪙', '💎', '🍪', '🌰', '🐚', '🏅'] as const;

export const THEMES = ['sunny', 'meadow', 'sky', 'berry', 'raccoon'] as const;
export type Theme = (typeof THEMES)[number];
