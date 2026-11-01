import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';

test('helpdesk: a kid asks, a parent says yes (a Parent Duty card) or not this time, and the kid sees how it goes', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const due = addDays(today, 3);

  await call(mom, 'PATCH', base, { helpdeskMaxOpen: 3 });
  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'nope' })).status, 400);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'other' })).status, 400, 'something else needs words');
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'fix', dueDate: addDays(today, -1) })).status, 400);
  const project = (await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'project', text: 'volcano for science fair', dueDate: due })).body;
  assert.equal(project.status, 'waiting');
  const shoes = (await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'clothes', text: 'new shoes' })).body;
  await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'talk' });
  // The open-request cap (set to 3 here).
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'ride' })).status, 429);
  // Kids can't see or answer each other's.
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/helpdesk`)).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/helpdesk/${project.id}/approve`)).status, 403);

  // Parents see them waiting (parent home, Home Assistant).
  const summary = (await call(mom, 'GET', `${base}/summary`)).body;
  assert.equal(summary.helpdesk.length, 3);
  assert.equal(summary.helpdesk[0].kid.name, 'Avaleigh');
  const ha = (await call(mom, 'GET', `${base}/ha/summary`)).body;
  assert.equal(ha.helpdesk_waiting, 3);
  assert.equal(ha.kids_by_name.avaleigh.helpdesk_waiting, 3);
  const events = (await call(mom, 'GET', `${base}/ha/events`)).body as { event: string; request?: string }[];
  assert.ok(events.some((e) => e.event === 'helpdesk_requested' && e.request === 'School project: volcano for science fair'), 'event for the webhook / polling');

  // Yes, with a tweaked title: it lands on Ava's Parent Duty board with the due date (and on the parents' calendar).
  const momId = (await call(mom, 'GET', base)).body.parents[0].id;
  const yes = (await call(mom, 'POST', `${base}/helpdesk/${project.id}/approve`, { title: 'Science fair volcano', assigneeId: momId })).body;
  assert.equal(yes.status, 'yes');
  const cards = (await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body;
  assert.equal(cards[0].title, 'Science fair volcano');
  assert.equal(cards[0].dueDate, due);
  assert.equal(cards[0].assigneeId, momId);
  const agenda = (await call(mom, 'GET', `${base}/agenda?start=${due}&days=1`)).body;
  assert.equal(agenda.days[0].duty[0].title, 'Science fair volcano');
  assert.equal((await call(mom, 'POST', `${base}/helpdesk/${project.id}/approve`)).status, 400, 'only once');

  // Not this time, with a note.
  await call(mom, 'POST', `${base}/helpdesk/${shoes.id}/deny`, { note: 'Your shoes still fit. Maybe at the end of the month!' });

  // The kid's view follows the card: yes → in progress → done.
  let mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body as { id: string; status: string; note: string | null }[];
  assert.equal(mine.find((r) => r.id === project.id)!.status, 'yes');
  assert.deepEqual(mine.find((r) => r.id === shoes.id), { ...mine.find((r) => r.id === shoes.id), status: 'no', note: 'Your shoes still fit. Maybe at the end of the month!' });
  await call(mom, 'PATCH', `${base}/parent-duty/${cards[0].id}`, { status: 'doing' });
  mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body;
  assert.equal(mine.find((r) => r.id === project.id)!.status, 'doing');
  await call(mom, 'PATCH', `${base}/parent-duty/${cards[0].id}`, { status: 'done' });
  mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body;
  assert.equal(mine.find((r) => r.id === project.id)!.status, 'done');

  // Taking back a waiting one; and it never shows on the family wall.
  const talk = mine.find((r) => r.status === 'waiting')!;
  assert.equal((await call(tablet, 'DELETE', `${base}/helpdesk/${talk.id}`)).status, 200);
  assert.ok(!JSON.stringify((await call(tablet, 'GET', '/api/kiosk/wall')).body).includes('volcano'));

  // Page switch off: nothing shows and nothing can be asked; the cap is a home setting.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['helpdesk'] });
  assert.deepEqual((await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body, []);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'fix' })).status, 403);
  assert.equal((await call(mom, 'PATCH', base, { helpdeskMaxOpen: -1 })).status, 400);
  assert.equal((await call(mom, 'PATCH', base, { helpdeskMaxOpen: 51 })).status, 400);
  await call(mom, 'PATCH', base, { helpdeskMaxOpen: 5 });
  assert.equal((await call(mom, 'GET', base)).body.helpdeskMaxOpen, 5);
});

test('helpdesk: kids can have 10 waiting by default, and a parent can lift the cap', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  assert.equal((await call(mom, 'GET', base)).body.helpdeskMaxOpen, 10);
  await asKid(ava);
  const ask = () => call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'fix' });
  for (let i = 0; i < 10; i++) assert.equal((await ask()).status, 200, `ask #${i + 1}`);
  const over = await ask();
  assert.equal(over.status, 429);
  assert.match(JSON.stringify(over.body), /10 waiting/);

  // 0 means no limit.
  await call(mom, 'PATCH', base, { helpdeskMaxOpen: 1 });
  await asKid(ben);
  const benAsk = () => call(tablet, 'POST', `${base}/kids/${ben.id}/helpdesk`, { kind: 'ride' });
  assert.equal((await benAsk()).status, 200);
  assert.equal((await benAsk()).status, 429);
  await call(mom, 'PATCH', base, { helpdeskMaxOpen: 0 });
  assert.equal((await call(mom, 'GET', base)).body.helpdeskMaxOpen, 0);
  assert.equal((await benAsk()).status, 200);
});

test('helpdesk: with Parent Duty off for the kid, a yes goes on the general list under their name', async () => {
  const { call, mom, base, ben, tablet, asKid } = await family();
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: ['parentduty'] });
  await asKid(ben);
  const r = (await call(tablet, 'POST', `${base}/kids/${ben.id}/helpdesk`, { kind: 'fix', text: 'my bike' })).body;
  await call(mom, 'POST', `${base}/helpdesk/${r.id}/approve`);
  const general = (await call(mom, 'GET', `${base}/parent-duty?kid=general`)).body;
  assert.equal(general[0].title, 'For Benedict: Fix something: my bike');
});

test('helpdesk: closing tickets at any stage, kids closing their own, and clearing closed history', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  await asKid(ava);
  const ask = async (kind: string, text?: string) => (await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind, text })).body;
  const waiting = await ask('fix', 'bike');
  const approved = await ask('project', 'volcano');
  const kidOwn = await ask('buy', 'markers');
  await call(mom, 'POST', `${base}/helpdesk/${approved.id}/approve`);
  await call(mom, 'POST', `${base}/helpdesk/${kidOwn.id}/approve`);

  // A parent closes a waiting one (it leaves the waiting list and frees a slot) and an approved one (card done by default).
  const c1 = (await call(mom, 'POST', `${base}/helpdesk/${waiting.id}/close`, { note: 'Fixed it this morning' })).body;
  assert.equal(c1.status, 'closed');
  assert.equal(c1.closeNote, 'Fixed it this morning');
  assert.equal((await call(mom, 'GET', `${base}/helpdesk`)).body.length, 0);
  await call(mom, 'POST', `${base}/helpdesk/${approved.id}/close`, {});
  let cards = (await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body as { title: string; status: string; notes: string | null }[];
  assert.equal(cards.find((c) => c.title.includes('volcano'))!.status, 'done');
  assert.equal((await call(mom, 'POST', `${base}/helpdesk/${approved.id}/close`, {})).status, 400, 'once');

  // Ben can't close Ava's; Ava closes her own: "All set, thanks!", and the card is finished with a note saying so.
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/helpdesk/${kidOwn.id}/close`, {})).status, 403);
  await asKid(ava);
  const c3 = (await call(tablet, 'POST', `${base}/helpdesk/${kidOwn.id}/close`, {})).body;
  assert.equal(c3.closeNote, 'All set, thanks!');
  assert.equal(c3.closedByKid, true);
  cards = (await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body;
  const markers = cards.find((c) => c.title.includes('markers'))!;
  assert.equal(markers.status, 'done');
  assert.match(markers.notes!, /Avaleigh closed it: “All set, thanks!”/);

  // A parent can keep the card open when closing.
  const keep = await ask('ride', 'to soccer');
  await call(mom, 'POST', `${base}/helpdesk/${keep.id}/approve`);
  await call(mom, 'POST', `${base}/helpdesk/${keep.id}/close`, { finishCard: false });
  cards = (await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body;
  assert.equal(cards.find((c) => c.title.includes('soccer'))!.status, 'todo');

  // History shows closed ones; a parent clears them (kids can't).
  const mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body as { status: string }[];
  assert.equal(mine.filter((r) => r.status === 'closed').length, 4);
  assert.equal((await call(tablet, 'DELETE', `${base}/kids/${ava.id}/helpdesk/closed`)).status, 403);
  assert.equal((await call(mom, 'DELETE', `${base}/kids/${ava.id}/helpdesk/closed`)).body.cleared, 4);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body.length, 0);
});
