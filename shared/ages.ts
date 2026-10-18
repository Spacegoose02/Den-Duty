// Kids' ages from a birthdate (so they update themselves), and what that means for the app:
// picture-first screens for kids who aren't reading yet, and chores that fit their age.

/** Whole years on `today` (both 'YYYY-MM-DD'), or null without a birthdate. */
export function ageOn(birthdate: string | null | undefined, today: string): number | null {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || birthdate > today) return null;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export interface AgeBand { id: 'tiny' | 'little' | 'middle' | 'tween' | 'teen'; label: string; min: number; max: number }

export const AGE_BANDS: AgeBand[] = [
  { id: 'tiny', label: 'Tiny helper', min: 0, max: 3 },
  { id: 'little', label: 'Little helper', min: 4, max: 5 },
  { id: 'middle', label: 'Big helper', min: 6, max: 8 },
  { id: 'tween', label: 'Super helper', min: 9, max: 12 },
  { id: 'teen', label: 'Pro', min: 13, max: 99 },
];

export const ageBand = (age: number | null): AgeBand | null => (age == null ? null : AGE_BANDS.find((b) => age >= b.min && age <= b.max) ?? null);

/** Most kids read chore names comfortably from about 6. Below that the board leads with pictures. */
export const PICTURE_MODE_UNDER = 6;

export function pictureMode(setting: string | null | undefined, age: number | null): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return age != null && age < PICTURE_MODE_UNDER;
}

export interface AgeChore { title: string; icon: string; points: number; minAge: number; maxAge?: number }

/** Chore ideas by age. Points scale a little with effort; parents can change anything. */
export const AGE_CHORES: AgeChore[] = [
  { title: 'Put toys in the bin', icon: '🧸', points: 1, minAge: 2 },
  { title: 'Put clothes in the hamper', icon: '🧺', points: 1, minAge: 2 },
  { title: 'Wipe up spills', icon: '🧽', points: 1, minAge: 3 },
  { title: 'Feed the pet (with help)', icon: '🐶', points: 1, minAge: 3, maxAge: 5 },
  { title: 'Make your bed', icon: '🛏️', points: 2, minAge: 4 },
  { title: 'Set the table', icon: '🍽️', points: 2, minAge: 4 },
  { title: 'Water the plants', icon: '🌱', points: 2, minAge: 4 },
  { title: 'Match the socks', icon: '🧦', points: 2, minAge: 4 },
  { title: 'Feed the pet', icon: '🐶', points: 2, minAge: 6 },
  { title: 'Empty small trash cans', icon: '🗑️', points: 2, minAge: 6 },
  { title: 'Unload the dishwasher', icon: '🍽️', points: 3, minAge: 7 },
  { title: 'Pack your school bag', icon: '🎒', points: 2, minAge: 6 },
  { title: 'Sweep the kitchen', icon: '🧹', points: 3, minAge: 7 },
  { title: 'Fold your laundry', icon: '👕', points: 3, minAge: 8 },
  { title: 'Make your lunch', icon: '🥪', points: 3, minAge: 9 },
  { title: 'Vacuum a room', icon: '🧹', points: 4, minAge: 9 },
  { title: 'Take out the trash', icon: '🗑️', points: 3, minAge: 9 },
  { title: 'Clean the bathroom sink', icon: '🧽', points: 4, minAge: 10 },
  { title: 'Help cook dinner', icon: '🍳', points: 5, minAge: 10 },
  { title: 'Do your own laundry', icon: '🧺', points: 5, minAge: 12 },
  { title: 'Mow the lawn', icon: '🌿', points: 6, minAge: 13 },
  { title: 'Wash the car', icon: '🚗', points: 6, minAge: 12 },
];

export function choresForAge(age: number | null): AgeChore[] {
  if (age == null) return AGE_CHORES.filter((c) => c.minAge >= 4 && c.minAge <= 9);
  return AGE_CHORES.filter((c) => age >= c.minAge && (c.maxAge == null || age <= c.maxAge));
}
