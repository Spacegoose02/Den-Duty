// Feelings check-in: once a day a kid taps how they feel. Parents see it (never the family wall or other kids).

export const FEELINGS = [
  { id: 'happy', icon: '😄', label: 'Happy', alert: false },
  { id: 'excited', icon: '🤩', label: 'Excited', alert: false },
  { id: 'calm', icon: '😌', label: 'Calm', alert: false },
  { id: 'okay', icon: '😐', label: 'Okay', alert: false },
  { id: 'tired', icon: '😴', label: 'Tired', alert: false },
  { id: 'worried', icon: '😟', label: 'Worried', alert: true },
  { id: 'sad', icon: '😢', label: 'Sad', alert: true },
  { id: 'angry', icon: '😠', label: 'Angry', alert: true },
  { id: 'scared', icon: '😨', label: 'Scared', alert: true },
] as const;
export type FeelingId = (typeof FEELINGS)[number]['id'];
export const FEELING_IDS = FEELINGS.map((f) => f.id) as FeelingId[];
export const feelingOf = (id: string) => FEELINGS.find((f) => f.id === id);

/** "Because of..." quick picks after a kid taps a feeling. */
export const FEELING_REASONS = [
  { id: 'school', icon: '🏫', label: 'School' },
  { id: 'friends', icon: '🧑‍🤝‍🧑', label: 'Friends' },
  { id: 'family', icon: '🏠', label: 'Family' },
  { id: 'body', icon: '🤒', label: 'My body' },
  { id: 'sleep', icon: '🛌', label: 'Sleep' },
  { id: 'games', icon: '🎮', label: 'Games or screens' },
  { id: 'other', icon: '💭', label: 'Something else' },
] as const;
export type FeelingReason = (typeof FEELING_REASONS)[number]['id'];
