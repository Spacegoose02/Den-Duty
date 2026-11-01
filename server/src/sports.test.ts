import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { cleanTeam, expireSportsCache, setSportsFetch } from './routes/sports.ts';

const VT = {
  sport: 'cfb', sportLabel: 'College Football', id: '259', name: 'Virginia Tech Hokies', abbreviation: 'VT',
  logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/259.png', color: '#630031', record: '6-3', rank: null,
  url: 'https://sports.lan/team.html?id=259',
  liveGame: {
    id: '401', date: '2026-11-01T20:00Z', status: { state: 'in', shortDetail: 'Q3 4:12' },
    home: { id: '258', abbreviation: 'UVA', shortName: 'Virginia', logo: 'javascript:alert(1)', score: 14 },
    away: { id: '259', abbreviation: 'VT', shortName: 'Virginia Tech', score: '21', curatedRank: 18 },
  },
  nextGame: {
    id: '402', date: '2026-11-08T17:00Z', broadcast: 'ACC Network', status: { state: 'pre' },
    home: { id: '259', abbreviation: 'VT', shortName: 'Virginia Tech' }, away: { id: '52', abbreviation: 'FSU', shortName: 'Florida St', color: 'ce0f3d' },
  },
  lastGame: null,
  upcoming: [],
};

test('a team from the tracker is cleaned: our side and the opponent, no unsafe links', () => {
  const t = cleanTeam(VT)!;
  assert.equal(t.liveGame!.isHome, false);
  assert.equal(t.liveGame!.team.abbreviation, 'VT');
  assert.equal(t.liveGame!.team.score, 21);
  assert.equal(t.liveGame!.team.rank, 18);
  assert.equal(t.liveGame!.opponent.score, 14);
  assert.equal(t.liveGame!.opponent.logo, null, 'only http(s) pictures');
  assert.equal(t.liveGame!.detail, 'Q3 4:12');
  assert.equal(t.nextGame!.isHome, true);
  assert.equal(t.nextGame!.opponent.color, '#ce0f3d');
  assert.equal(t.lastGame, null);
  assert.equal((t as unknown as { url?: string }).url, undefined, 'no links off the tablet');
  assert.equal(cleanTeam({ id: '1' }), null);
  assert.equal(cleanTeam(null), null);
});

test("each kid's teams come from the sports tracker with their own key, and the tracker being down is gentle", async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid } = await family();
  let down = false;
  const seen: string[] = [];
  setSportsFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String(input));
    if (down) throw new Error('ECONNREFUSED');
    const auth = (init?.headers as Record<string, string>).authorization;
    if (String(input) !== 'http://sports.lan:3000/api/account/teams') return new Response('{}', { status: 404 });
    if (auth === 'Bearer key_ava') return Response.json({ user: { displayName: 'Ava' }, teams: [VT] });
    return Response.json({ error: 'nope' }, { status: 401 });
  }) as typeof fetch);

  // Parents only for the settings.
  assert.equal((await call(tablet, 'PUT', `${base}/sports`, { url: 'http://x' })).status, 403);
  assert.equal((await call(mom, 'PUT', `${base}/sports`, { url: 'sports.lan' })).status, 400);
  assert.equal((await call(mom, 'PUT', `${base}/sports`, { url: 'http://sports.lan:3000/?x=1' })).body.url, 'http://sports.lan:3000');

  // Nothing shows for a kid without a key.
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/sports`)).body.sports, null);

  const ok = await call(mom, 'PUT', `${base}/kids/${ava.id}/sports`, { key: ' key_ava ' });
  assert.deepEqual(ok.body, { hasKey: true, check: { ok: true, teams: 1, displayName: 'Ava' } });
  const raw = (db.prepare('SELECT sports_key FROM members WHERE id = ?').get(ava.id) as { sports_key: string }).sports_key;
  assert.ok(!raw.includes('key_ava'), 'the key is sealed at rest');
  const wrong = await call(mom, 'PUT', `${base}/kids/${ben.id}/sports`, { key: 'old_key' });
  assert.equal(wrong.body.check.ok, false);
  assert.match(wrong.body.check.reason, /key is wrong/);

  const settings = (await call(mom, 'GET', `${base}/sports`)).body;
  assert.equal(settings.url, 'http://sports.lan:3000');
  assert.deepEqual(settings.kids.map((k: { hasKey: boolean }) => k.hasKey), [true, true]);
  assert.ok(!JSON.stringify(settings).includes('key_ava'), 'keys never come back out');

  // Ava sees her own teams on the tablet, but not Ben's.
  await asKid(ava);
  const mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/sports`)).body.sports;
  assert.equal(mine.teams[0].name, 'Virginia Tech Hokies');
  assert.equal(mine.teams[0].liveGame.team.score, 21);
  assert.equal(mine.stale, false);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/sports`)).status, 403);
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});

  // The family wall shows them too; Ben's wrong key just shows "can't reach".
  let wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  const wallAva = wall.kids.find((k: { id: string }) => k.id === ava.id);
  assert.equal(wallAva.sports.teams[0].abbreviation, 'VT');
  assert.equal(wall.kids.find((k: { id: string }) => k.id === ben.id).sports.teams, null);

  // The tracker goes down: Ava keeps her last scores, marked as old.
  down = true;
  expireSportsCache();
  const kept = (await call(mom, 'GET', `${base}/kids/${ava.id}/sports`)).body.sports;
  assert.equal(kept.stale, true);
  assert.equal(kept.teams[0].abbreviation, 'VT');
  // Saving the address again starts fresh, so with the tracker down there's nothing to fall back on.
  await call(mom, 'PUT', `${base}/sports`, { url: 'http://sports.lan:3000' });
  const old = (await call(mom, 'GET', `${base}/kids/${ava.id}/sports`)).body.sports;
  assert.equal(old.teams, null);
  assert.equal(old.stale, true);
  down = false;
  await call(mom, 'PUT', `${base}/kids/${ava.id}/sports`, { key: 'key_ava' });
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/sports`)).body.sports.stale, false);
  wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.equal(wall.kids.find((k: { id: string }) => k.id === ava.id).sports.teams.length, 1);

  // Removing the key or the address takes the cards away.
  await call(mom, 'PUT', `${base}/kids/${ava.id}/sports`, { key: null });
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/sports`)).body.sports, null);
  assert.equal((await call(mom, 'GET', `${base}/sports`)).body.kids[0].hasKey, false);
  assert.ok(seen.every((u) => u.startsWith('http://sports.lan:3000/')));
});
