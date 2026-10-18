// Per-kid switches: whole pages a parent can turn off for one kid, and the sections inside Doctors.
// Off only hides things; the data stays and comes back when the switch is turned on again.

export const KID_PAGES = [
  { id: 'chores', label: 'Chores', icon: '🧹', hint: 'Daily chores, bonus chores and the week' },
  { id: 'parentduty', label: 'Parent Duty', icon: '📝', hint: 'Your to-dos for this kid' },
  { id: 'timeout', label: 'Time-outs', icon: '⏳', hint: 'Time-outs and buying time back' },
  { id: 'goals', label: 'Goals & rewards', icon: '🎁', hint: 'Goals, rewards and reward votes' },
  { id: 'stats', label: 'Stats & badges', icon: '📊', hint: 'Charts, streaks, levels and badges' },
  { id: 'doctors', label: 'Doctors', icon: '🩺', hint: 'Appointments, goals and notes' },
  { id: 'calendar', label: 'Calendar', icon: '📅', hint: 'Their calendar link and subscribed feeds' },
] as const;

export type KidPage = (typeof KID_PAGES)[number]['id'];
export const KID_PAGE_IDS = KID_PAGES.map((p) => p.id) as KidPage[];

export const DOCTOR_AREAS = [
  { id: 'appointments', label: 'Appointments', icon: '📅' },
  { id: 'doctor', label: 'Doctor / health', icon: '🩺' },
  { id: 'speech', label: 'Speech', icon: '🗣️' },
  { id: 'feeding', label: 'Feeding', icon: '🥄' },
  { id: 'ot', label: 'OT / fine motor', icon: '✋' },
  { id: 'sensory', label: 'Sensory', icon: '🌀' },
  { id: 'selfcare', label: 'Self-care', icon: '🪥' },
  { id: 'pt', label: 'Physical therapy', icon: '🏃' },
  { id: 'behavioral', label: 'Behavioral', icon: '🧩' },
  { id: 'dental', label: 'Dental', icon: '🦷' },
  { id: 'development', label: 'Development', icon: '🌱' },
] as const;

export type DoctorArea = (typeof DOCTOR_AREAS)[number]['id'];
export const DOCTOR_AREA_IDS = DOCTOR_AREAS.map((a) => a.id) as DoctorArea[];

/** Which Doctors section a goal area belongs to ('other' and 'social' are always shown). */
export const GOAL_AREA_SECTION: Record<string, DoctorArea | null> = {
  development: 'development', speech: 'speech', feeding: 'feeding', doctor: 'doctor', motor: 'ot', sensory: 'sensory',
  selfcare: 'selfcare', physical: 'pt', behavioral: 'behavioral', dental: 'dental', social: null, other: null,
};

/** Which Doctors section an appointment kind belongs to (the whole list also needs 'appointments' on). */
export const APPOINTMENT_SECTION: Record<string, DoctorArea | null> = {
  doctor: 'doctor', speech: 'speech', feeding: 'feeding', occupational: 'ot', physical: 'pt', behavioral: 'behavioral', dental: 'dental', other: null,
};

/** Parses a stored "off" list, keeping only known ids. */
export function offList<T extends string>(raw: unknown, known: readonly T[]): T[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.filter((x): x is T => known.includes(x)) : [];
  } catch {
    return [];
  }
}

export const goalAreaOn = (area: string, off: readonly string[]) => { const s = GOAL_AREA_SECTION[area]; return !s || !off.includes(s); };
export const appointmentOn = (kind: string, off: readonly string[]) => {
  if (off.includes('appointments')) return false;
  const s = APPOINTMENT_SECTION[kind];
  return !s || !off.includes(s);
};

/** The raccoon doctor who answers "Ask" questions in Doctors. One place to rename it. */
export const DOCTOR_NAME = 'Dr. Bandit';
