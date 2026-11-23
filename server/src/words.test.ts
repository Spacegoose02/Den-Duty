import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';

test('new words: tap to count, milestones pay points once, undo takes them back', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const k = `${base}/kids/${ava.id}`;
  const ledger = async () => (await call(mom, 'GET', `${k}/ledger`)).body as { balance: number; entries: { reason: string; amount: number }[] };

  // The defaults until a parent sets their own; bad milestones are refused.
  const start = (await call(mom, 'GET', `${k}/words`)).body;
  assert.deepEqual(start.milestones.map((m: { times: number }) => m.times), [5, 10, 25]);
  assert.equal(start.custom, false);
  assert.equal((await call(mom, 'PUT', `${k}/words/milestones`, { milestones: [{ times: 0, points: 1 }] })).status, 400);
  assert.equal((await call(mom, 'PUT', `${k}/words/milestones`, { milestones: [{ times: 3, points: 1 }, { times: 3, points: 2 }] })).status, 400);
  const set = (await call(mom, 'PUT', `${k}/words/milestones`, { milestones: [{ times: 3, points: 2 }, { times: 1, points: 1 }] })).body;
  assert.deepEqual(set.milestones, [{ times: 1, points: 1 }, { times: 3, points: 2 }], 'sorted');

  // Adding a word counts the first time (and pays the 1-time milestone); the same word twice is refused.
  const { body: ball } = await call(mom, 'POST', `${k}/words`, { word: 'Ball', note: 'says "ba"' });
  assert.equal(ball.count, 1);
  assert.equal(ball.awarded, 1);
  assert.deepEqual(ball.next, { times: 3, points: 2 });
  assert.equal((await call(mom, 'POST', `${k}/words`, { word: 'ball' })).status, 400);
  const { body: dog } = await call(mom, 'POST', `${k}/words`, { word: 'dog', saidNow: false, addedOn: addDays(today, -3) });
  assert.equal(dog.count, 0);
  assert.equal(dog.awarded, 0);
  assert.equal((await call(mom, 'POST', `${k}/words`, { word: 'cat', addedOn: addDays(today, 1) })).status, 400, 'not in the future');

  await call(mom, 'POST', `${base}/words/${ball.id}/say`);
  const third = (await call(mom, 'POST', `${base}/words/${ball.id}/say`)).body;
  assert.equal(third.count, 3);
  assert.equal(third.awarded, 2);
  assert.equal(third.word.mastered, true);
  assert.equal((await ledger()).balance, 3);
  // Kept private on the kid's history until Doctors is shared with them.
  assert.deepEqual((await ledger()).entries.map((e) => e.reason), ['🗣️ Great talking!', '🗣️ Great talking!']);

  // Undoing the tap that paid takes the points back; tapping again pays again.
  const undo = (await call(mom, 'DELETE', `${base}/words/${ball.id}/say`)).body;
  assert.equal(undo.reversed, 2);
  assert.equal(undo.word.count, 2);
  assert.equal((await ledger()).balance, 1);
  await call(mom, 'PATCH', `${k}/therapy`, { kidVisible: true });
  assert.equal((await call(mom, 'POST', `${base}/words/${ball.id}/say`)).body.awarded, 2);
  assert.equal((await ledger()).entries[0].reason, '🗣️ You said “Ball” 3 times!');
  assert.equal((await call(mom, 'DELETE', `${base}/words/${dog.id}/say`)).status, 400, 'nothing to undo');

  // A word can have its own milestones; null goes back to the kid's.
  const own = (await call(mom, 'PATCH', `${base}/words/${dog.id}`, { milestones: [{ times: 2, points: 5 }] })).body;
  assert.equal(own.ownMilestones, true);
  await call(mom, 'POST', `${base}/words/${dog.id}/say`);
  assert.equal((await call(mom, 'POST', `${base}/words/${dog.id}/say`)).body.awarded, 5);
  assert.equal((await call(mom, 'PATCH', `${base}/words/${dog.id}`, { milestones: null })).body.ownMilestones, false);
  assert.equal((await call(mom, 'PATCH', `${base}/words/${dog.id}`, { word: 'BALL' })).status, 400, 'no duplicates on rename');

  const list = (await call(mom, 'GET', `${k}/words`)).body;
  assert.equal(list.words.length, 2);
  assert.equal(list.words.find((w: { id: string }) => w.id === ball.id).pointsEarned, 3);
  assert.equal(list.says.reduce((a: number, d: { count: number }) => a + d.count, 0), 5);

  // Parents only, the kid's own home only, and only with Doctors and Speech on.
  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${k}/words`)).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/words/${ball.id}/say`)).status, 403);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/words`)).body.words.length, 0);
  await call(mom, 'PATCH', k, { doctorAreasOff: ['speech'] });
  assert.equal((await call(mom, 'GET', `${k}/words`)).status, 403);
  assert.equal((await call(mom, 'POST', `${base}/words/${ball.id}/say`)).status, 403);
  assert.equal((await call(mom, 'GET', `${k}/health/summary`)).body.words, null, 'and off the summary');
  await call(mom, 'PATCH', k, { doctorAreasOff: [] });

  // Deleting a word keeps the points already paid.
  const before = (await ledger()).balance;
  await call(mom, 'DELETE', `${base}/words/${dog.id}`);
  assert.equal((await ledger()).balance, before);
});

test('new words on the visit summary, share links and the CSV export', async () => {
  const { call, mom, base, ava, today } = await family();
  const k = `${base}/kids/${ava.id}`;
  const { body: ball } = await call(mom, 'POST', `${k}/words`, { word: 'ball' });
  await call(mom, 'POST', `${base}/words/${ball.id}/say`);
  await call(mom, 'POST', `${k}/words`, { word: 'up', addedOn: addDays(today, -60) });

  const s = (await call(mom, 'GET', `${k}/health/summary?days=30`)).body;
  assert.equal(s.words.total, 2);
  assert.equal(s.words.newInRange, 1);
  assert.equal(s.words.saysInRange, 2, '"up" was said before the period');
  assert.deepEqual(s.words.words.map((w: { word: string; total: number }) => [w.word, w.total]), [['up', 1], ['ball', 2]]);

  // A share link shows the words only when the family ticks the box.
  const anon = {};
  const { body: plain } = await call(mom, 'POST', `${k}/share-links`, { label: 'Dr. A' });
  assert.equal((await call(anon, 'GET', `/api${plain.url}`)).body.words, null);
  const { body: speech } = await call(mom, 'POST', `${k}/share-links`, { label: 'Ms. Lee (speech)', showWords: true });
  assert.equal(speech.showWords, true);
  assert.equal((await call(anon, 'GET', `/api${speech.url}`)).body.words.total, 2);

  const csv = (await call(mom, 'GET', `${k}/doctors/export?format=csv&what=words`)).body as string;
  assert.match(csv, /"word","added","times_said"/);
  assert.match(csv, /"ball","[\d-]+","2"/);
  const json = (await call(mom, 'GET', `${k}/doctors/export`)).body;
  assert.equal(json.words.length, 2);
  assert.equal(json.wordSays.length, 3);
});
