import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

type Link = { url: string; hasKey: boolean; voice: string };
type Saved = Link & { check: { ok: true; voices: string[]; voiceFound: boolean } | { ok: false; reason: string } | null };

// Kokoro's voice names: language letter, f/m, then the name (af_heart = American English, female, Heart).
const LANGS: Record<string, string> = {
  a: 'American English', b: 'British English', e: 'Spanish', f: 'French', h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Portuguese', z: 'Chinese',
};
const voiceLang = (v: string) => LANGS[v[0]] ?? 'Other';
const voiceName = (v: string) => {
  const name = v.slice(3);
  const who = v[1] === 'f' ? 'girl/woman' : v[1] === 'm' ? 'boy/man' : '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${who ? ` (${who})` : ''}`;
};
const SAMPLE = 'Hi! You have 3 chores left. Make your bed, feed the cat, and brush your teeth.';

/** Settings card: read-aloud in a Kokoro voice from the family's own Kokoro server, instead of the device's voice. */
export function ReadAloudVoiceCard() {
  const { base, toast, refreshHome } = useApp();
  const [s, reload] = useLoad<Link>(`${base}/tts-link`);
  const [url, setUrl] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [voices, setVoices] = useState<string[] | null>(null);
  // Once linked, fetch the voices to pick from (again whenever the address changes).
  const linkedUrl = s?.url ?? '';
  useEffect(() => {
    setVoices(null);
    if (!linkedUrl) return;
    let live = true;
    api<{ voices: string[] }>(`${base}/tts/voices`).then((r) => { if (live) setVoices(r.voices); }).catch(() => {});
    return () => { live = false; };
  }, [base, linkedUrl]);
  if (!s) return null;

  const save = async (body: { url: string; key?: string; voice?: string }) => {
    try {
      const r = await api<Saved>(`${base}/tts-link`, { method: 'PUT', body });
      if (r.check?.ok) setVoices(r.check.voices);
      toast(!r.url ? 'Read-aloud is back to the device voice'
        : r.check?.ok ? (r.check.voiceFound ? `Read-aloud now uses Kokoro's ${voiceName(r.voice)} voice 🗣️` : `Saved, but Kokoro has no voice called ${r.voice}. Pick one below.`)
          : `Saved, but: ${r.check?.reason ?? 'Kokoro could not be checked'}`);
      setUrl(null);
      setKey('');
      setVoice(null);
      await reload();
      await refreshHome();
    } catch (e) { toast((e as Error).message); }
  };

  const picked = voice ?? s.voice;
  const tryIt = () => {
    const q = new URLSearchParams({ text: SAMPLE, voice: picked, lang: 'en' });
    new Audio(`${base}/tts/say?${q}`).play().catch(() => toast("Kokoro didn't answer. Check the address and that it's running."));
  };
  const groups = voices ? Object.entries(voices.reduce<Record<string, string[]>>((g, v) => ((g[voiceLang(v)] ??= []).push(v), g), {})) : [];

  return (
    <div className="card stack" id="read-aloud">
      <h2 style={{ margin: 0 }}>🗣️ Read-aloud voice</h2>
      <p className="small muted" style={{ margin: 0 }}>
        The 🔊 buttons and the routine player read with the device's own voice. Point Den Duty at your own{' '}
        <a href="https://github.com/remsky/Kokoro-FastAPI" target="_blank" rel="noreferrer">Kokoro</a> server for a warmer,
        natural-sounding voice on every tablet and phone. Text goes only to your Kokoro server, and if it's down the device voice takes over.
      </p>
      <div className="row">
        <input placeholder="http://192.168.1.10:8880" value={url ?? s.url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 2, minWidth: 220 }} aria-label="Kokoro's address" />
        <input type="password" placeholder={s.hasKey ? 'Key saved' : 'Key (optional)'} value={key} onChange={(e) => setKey(e.target.value)}
          style={{ flex: 1, minWidth: 160 }} aria-label="Kokoro key" autoComplete="off" />
        <button className="primary" onClick={() => void save({ url: (url ?? s.url).trim(), ...(key.trim() ? { key: key.trim() } : {}), ...(voice ? { voice } : {}) })}>Save</button>
        {s.url && <button className="ghost" onClick={() => void save({ url: '' })}>Use device voice</button>}
      </div>
      {s.url && (
        <div className="row">
          <label className="small" style={{ minWidth: 60 }} htmlFor="kokoro-voice">Voice</label>
          {voices ? (
            <select id="kokoro-voice" value={picked} onChange={(e) => setVoice(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
              {!voices.includes(picked) && <option value={picked}>{picked}</option>}
              {groups.map(([lang, list]) => (
                <optgroup key={lang} label={lang}>
                  {list.map((v) => <option key={v} value={v}>{voiceName(v)}</option>)}
                </optgroup>
              ))}
            </select>
          ) : (
            <input id="kokoro-voice" value={picked} onChange={(e) => setVoice(e.target.value)} style={{ flex: 1, minWidth: 200 }} placeholder="af_heart" />
          )}
          <button onClick={tryIt}>▶ Try it</button>
          {voice && voice !== s.voice && <button className="primary" onClick={() => void save({ url: s.url, voice })}>Use this voice</button>}
        </div>
      )}
      {s.url && (
        <p className="small muted" style={{ margin: 0 }}>
          Spanish and French boards use a Kokoro voice for that language when your server has one (Dora, Siwis), and the device voice otherwise.
        </p>
      )}
    </div>
  );
}
