import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { cleanWeather, expireWeatherCache, setWeatherFetch } from './routes/weather.ts';

// What Weather Scout's /api/connect/summary sends.
const SUMMARY = {
  location: { name: 'Richmond, VA', lat: 37.54, lon: -77.44 },
  units: { temp: '°F', wind: 'mph', precip: 'in', pressure: 'hPa' },
  current: { temp: 52.4, feelsLike: 47.2, icon: 'rain', label: 'Rain', kidLabel: 'Rainy', isDay: true, windSpeed: 5, uv: 3 },
  today: { high: 60, low: 42, precipChance: 80, icon: 'rain', kidLabel: 'Rainy' },
  raccoon: { items: ['raincoat', 'boots', '<script>'], mood: 'shivering', art: { full: '/rocky/rocky.png', dressed: '/api/connect/rocky.svg?items=raincoat%2Cboots&mood=shivering' } },
  checklist: [{ id: 'raincoat', emoji: '🧥', label: 'Rain jacket', why: 'Good chance of rain today.' }],
  playground: { rating: 'yellow', label: 'Okay, with care', emoji: '⚠️', reasons: ['It has been raining, so it may be wet or muddy.'] },
  sky: { sunset: '2026-11-02T17:30', minutesToSunset: 200 },
  alerts: [{ id: 'urn:a1', event: 'Wind Advisory', severity: 'Minor', headline: 'Wind Advisory until 6 PM', kid: 'It will be very windy. Hold on to your hat!', ends: '2026-11-02T23:00:00Z' }],
  alertsAvailable: true,
  updatedAt: '2026-11-02T18:40:00.000Z',
};

test('a Weather Scout summary is cleaned to plain fields', () => {
  const w = cleanWeather(SUMMARY)!;
  assert.equal(w.place, 'Richmond, VA');
  assert.equal(w.now.temp, 52);
  assert.equal(w.now.icon, 'rain');
  assert.deepEqual(w.outfit, ['raincoat', 'boots'], 'only plain outfit names');
  assert.equal(w.mood, 'shivering');
  assert.equal(w.rocky, true);
  assert.equal(cleanWeather({ ...SUMMARY, raccoon: { items: [], mood: 'grumpy' } })!.rocky, false, 'older Weather Scout: no picture');
  assert.equal(cleanWeather({ ...SUMMARY, raccoon: { items: [], mood: 'grumpy' } })!.mood, 'happy');
  assert.equal(w.recess.rating, 'yellow');
  assert.equal(w.alerts[0].event, 'Wind Advisory');
  assert.equal(w.alerts[0].severity, 'Minor');
  assert.equal(cleanWeather({ current: {} }), null);
  assert.equal(cleanWeather(null), null);
  assert.equal(cleanWeather({ ...SUMMARY, current: { ...SUMMARY.current, icon: 'tornado' } })!.now.icon, 'cloudy');
});

test('the home links Weather Scout with a key; boards and the wall show the weather; Weather Scout being down is gentle', async () => {
  const { db, call, mom, base, ava, tablet, asKid } = await family();
  let down = false;
  const fetchRocky = async () => {
    const r = await call(tablet, 'GET', `${base}/weather/rocky.svg?v=x`);
    return { status: r.status, type: String(r.headers['content-type'] ?? ''), csp: String(r.headers['content-security-policy'] ?? ''), text: String(r.body ?? '') };
  };
  const seen: string[] = [];
  setWeatherFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String(input));
    if (down) throw new Error('ECONNREFUSED');
    const auth = (init?.headers as Record<string, string>).authorization;
    if (String(input).startsWith('http://weather.lan:8080/api/connect/rocky.svg?')) {
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg"><title>${new URL(String(input)).search}</title></svg>`, { headers: { 'content-type': 'image/svg+xml' } });
    }
    if (String(input) !== 'http://weather.lan:8080/api/connect/summary') return new Response('{}', { status: 404 });
    if (auth === 'Bearer wsk_good_key_1234567890') return Response.json(SUMMARY);
    return Response.json({ error: 'nope' }, { status: 401 });
  }) as typeof fetch);

  // Parents only for the settings, and the address must be http(s).
  assert.equal((await call(tablet, 'PUT', `${base}/weather-link`, { url: 'http://x' })).status, 403);
  assert.equal((await call(mom, 'PUT', `${base}/weather-link`, { url: 'weather.lan' })).status, 400);

  // Not linked: nothing shows.
  assert.equal((await call(mom, 'GET', `${base}/weather`)).body.weather, null);

  const wrong = await call(mom, 'PUT', `${base}/weather-link`, { url: 'http://weather.lan:8080/?x=1', key: 'wsk_old' });
  assert.equal(wrong.body.url, 'http://weather.lan:8080');
  assert.equal(wrong.body.check.ok, false);
  assert.match(wrong.body.check.reason, /key is wrong/);

  const ok = await call(mom, 'PUT', `${base}/weather-link`, { url: 'http://weather.lan:8080', key: ' wsk_good_key_1234567890 ' });
  assert.deepEqual(ok.body.check, { ok: true, place: 'Richmond, VA', temp: 52 });
  const raw = (db.prepare('SELECT weather_key FROM homes').get() as { weather_key: string }).weather_key;
  assert.ok(!raw.includes('wsk_good'), 'the key is sealed at rest');
  const settings = (await call(mom, 'GET', `${base}/weather-link`)).body;
  assert.deepEqual(settings, { url: 'http://weather.lan:8080', hasKey: true });

  // Saving the address again without a key keeps the key.
  assert.equal((await call(mom, 'PUT', `${base}/weather-link`, { url: 'http://weather.lan:8080' })).body.check.ok, true);

  // A kid on the tablet sees it, and so does the family wall.
  await asKid(ava);
  const mine = (await call(tablet, 'GET', `${base}/weather`)).body.weather;
  assert.equal(mine.now.kidLabel, 'Rainy');
  assert.equal(mine.checklist[0].label, 'Rain jacket');
  assert.equal(mine.stale, false);
  assert.equal(mine.mood, 'shivering');

  // Rocky in today's outfit comes through this server, locked down to a picture.
  const rocky = await fetchRocky();
  assert.equal(rocky.status, 200);
  assert.match(rocky.type, /^image\/svg\+xml/);
  assert.match(rocky.csp, /default-src 'none'.*sandbox/);
  assert.match(rocky.text, /\?items=raincoat%2Cboots&mood=shivering/);
  const asked = seen.filter((u) => u.includes('rocky.svg')).length;
  await fetchRocky();
  assert.equal(seen.filter((u) => u.includes('rocky.svg')).length, asked, 'the same outfit is asked for once');
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.equal(wall.weather.recess.rating, 'yellow');
  assert.equal(wall.weather.alerts[0].kid, 'It will be very windy. Hold on to your hat!');
  assert.ok(!JSON.stringify(wall).includes('wsk_'), 'the key never reaches the tablet');

  // Weather Scout goes down: the last weather stays, marked as old.
  down = true;
  expireWeatherCache();
  const kept = (await call(mom, 'GET', `${base}/weather`)).body.weather;
  assert.equal(kept.stale, true);
  assert.equal(kept.now.temp, 52);
  down = false;

  // Unlinking takes it away and forgets the key.
  await call(mom, 'PUT', `${base}/weather-link`, { url: '' });
  assert.equal((await fetchRocky()).status, 404);
  assert.equal((await call(mom, 'GET', `${base}/weather`)).body.weather, null);
  assert.deepEqual((await call(mom, 'GET', `${base}/weather-link`)).body, { url: '', hasKey: false });
  assert.ok(seen.every((u) => u.startsWith('http://weather.lan:8080/')));
});
