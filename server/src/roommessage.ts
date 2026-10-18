// The daily "your den" message on a kid's screen: one per kid per day, AI-written when AI ideas are on (only the age
// is sent; the name is filled in here) and otherwise picked from a rotating built-in set. Cached so it's stable all day.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { aiSettings, roomMessageAi } from './ai.ts';
import { kidAiOn } from './routes/homes.ts';

export const ROOM_MESSAGES = [
  'Good morning, {name}! A tidy den is a happy den. 🦝',
  '{name}, every raccoon knows: toys back in their bins means more room to play!',
  "Make your bed and your whole den smiles, {name}. You've got this! 🛏️",
  'Clothes in the hamper, {name}, and your den will feel brand new.',
  "{name}, you're a super den-keeper! One little tidy-up at a time. ⭐",
  "Books on the shelf are cozy books, {name}. They'll be ready for story time!",
  'Five-minute tidy, {name}! Set a timer and see how much you can do. ⏱️',
  "{name}, a clean floor is a raccoon's dance floor. 💃",
  'Your den is your special place, {name}. Give it a little love today! 💛',
  'Raccoons wash up and tidy up. Ready to make your den shine, {name}? ✨',
  '{name}, start with one corner. Then the next. Small steps make a big den!',
  "Put away one thing you used today, {name}. That's how the pros do it! 🦝",
  "{name}, you did great yesterday. Let's keep your den sparkly today!",
  'A tidy desk helps big ideas grow, {name}. 🌱',
  "Shoes in a row and your den's good to go, {name}! 👟",
  "{name}, try a tidy-up race with your favorite song. Can you finish before it ends? 🎵",
  'Stuffies love their spot on the bed, {name}. Tuck them in! 🧸',
  "Wow, {name}! Every time you tidy, your den gets happier. Keep it up!",
  "{name}, pick up five things right now. Ready, set, go! 🏁",
  'Bed made, toys away, ready for a great day, {name}! ☀️',
  "{name}, the den inspector raccoon is so proud of you. 🔍🦝",
  "A clean den means finding your favorite things fast, {name}!",
  "{name}, you're the boss of your den. Make it awesome today! 👑",
  "Even small tidy-ups count, {name}. You're doing great! 🌟",
];

/** Built-in message for a kid on a date: rotates daily, and different kids get different ones on the same day. */
export function builtinRoomMessage(memberId: string, date: string): string {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  let h = 0;
  for (const ch of memberId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROOM_MESSAGES[(day + h) % ROOM_MESSAGES.length];
}

// After an AI failure, a home waits a while before trying again so kids' screens don't wait on it.
const retryAfter = new Map<string, number>();

export async function roomMessage(db: DatabaseSync, homeId: string, kid: { id: string; name: string; age: number | null }, date: string): Promise<{ text: string; source: 'ai' | 'builtin' }> {
  const fill = (t: string) => t.replaceAll('{name}', kid.name);
  const ai = aiSettings(db, homeId);
  // The per-kid AI switch: off means the built-in messages only.
  if (!kidAiOn(db, kid.id)) ai.enabled = false;
  const cached = db.prepare('SELECT text, source FROM room_messages WHERE member_id = ? AND date = ?').get(kid.id, date) as Row | undefined;
  // A cached built-in message is upgraded once AI is turned on; an AI message stays for the day.
  if (cached && (cached.source === 'ai' || !ai.enabled || !ai.hasKey)) return { text: fill(cached.text as string), source: cached.source as 'ai' | 'builtin' };
  let text = builtinRoomMessage(kid.id, date);
  let source: 'ai' | 'builtin' = 'builtin';
  if (ai.enabled && ai.hasKey && (retryAfter.get(homeId) ?? 0) < Date.now()) {
    try {
      text = await roomMessageAi(db, homeId, kid.age, date);
      source = 'ai';
    } catch {
      retryAfter.set(homeId, Date.now() + 30 * 60e3);
    }
  }
  if (source === 'ai' || !cached) {
    db.prepare('INSERT OR REPLACE INTO room_messages (member_id, date, text, source) VALUES (?, ?, ?, ?)').run(kid.id, date, text, source);
    db.prepare("DELETE FROM room_messages WHERE member_id = ? AND date < date(?, '-7 days')").run(kid.id, date);
  }
  return { text: fill(text), source };
}

/** Tests only. */
export function resetRoomRetry(): void { retryAfter.clear(); }
