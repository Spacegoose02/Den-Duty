// Practice and habits beyond chores: reading, an instrument, homework. Ready-made ones for the habit form.

export const HABIT_TEMPLATES = [
  { title: 'Reading', icon: '📚', minutes: 20 },
  { title: 'Piano', icon: '🎹', minutes: 15 },
  { title: 'Guitar', icon: '🎸', minutes: 15 },
  { title: 'Violin', icon: '🎻', minutes: 15 },
  { title: 'Homework', icon: '✏️', minutes: 30 },
  { title: 'Math facts', icon: '🔢', minutes: 10 },
  { title: 'Spelling words', icon: '🔤', minutes: 10 },
  { title: 'Writing', icon: '✍️', minutes: 15 },
  { title: 'A new language', icon: '🗣️', minutes: 10 },
  { title: 'Exercise', icon: '🏃', minutes: 20 },
  { title: 'Sports practice', icon: '⚽', minutes: 30 },
  { title: 'Drawing', icon: '🎨', minutes: 15 },
  { title: 'Typing', icon: '⌨️', minutes: 10 },
  { title: 'Coding', icon: '💻', minutes: 20 },
] as const;

/** How many minutes one practice can log (a long piano day is fine; a typo of 6000 isn't). */
export const HABIT_MAX_MINUTES = 240;
