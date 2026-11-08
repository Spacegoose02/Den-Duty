import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DICTS, translate } from './i18n.ts';
import { TIDY_TEXT } from './den.ts';
import { FEELINGS, FEELING_REASONS } from './feelings.ts';

const WEB = join(import.meta.dirname, '../web/src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

/** Every literal passed to t(...) in the web app, plus the shared labels that go through t(). */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of files(WEB)) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('useT') && !src.includes('translate(')) continue;
    for (const m of src.matchAll(/\bt\(\s*(?:([^'"(),]+?)\s*\?\s*)?(['"])((?:\\.|(?!\2).)*)\2(?:\s*:\s*(['"])((?:\\.|(?!\4).)*)\4)?/g)) {
      keys.add(m[3].replace(/\\'/g, "'"));
      if (m[5] != null) keys.add(m[5].replace(/\\'/g, "'"));
    }
  }
  for (const s of Object.values(TIDY_TEXT)) keys.add(s);
  for (const x of [...FEELINGS, ...FEELING_REASONS]) keys.add(x.label);
  for (const s of ['To do', 'Nothing left!', 'Doing', 'Tap ▶ to start one', 'Waiting for a grown-up', 'Done']) keys.add(s);
  return keys;
}

test('every kid-screen string has a Spanish and French translation', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 80, `found ${keys.size} keys`);
  for (const lang of ['es', 'fr'] as const) {
    const missing = [...keys].filter((k) => k && !(k in DICTS[lang]));
    assert.deepEqual(missing, [], `${lang} is missing translations`);
  }
});

test('translations keep their placeholders', () => {
  for (const lang of ['es', 'fr'] as const) {
    for (const [k, v] of Object.entries(DICTS[lang])) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(vars(v), vars(k), `${lang}: ${k}`);
    }
  }
  assert.equal(translate('es', 'Hi {name}!', { name: 'Ava' }), '¡Hola, Ava!');
  assert.equal(translate('fr', 'Not in the dictionary'), 'Not in the dictionary');
  assert.equal(translate('en', '{n} min', { n: 5 }), '5 min');
});
