// Read-aloud for kids who can't read yet. With Kokoro set up (Settings → Read-aloud voice) the family's own Kokoro
// server reads, through this server; otherwise, or whenever Kokoro can't answer, the browser's own speech does.

let speechLang = 'en-US';
/** The language read-aloud speaks in (set by the kid board or the wall). */
export function setSpeechLang(code: string): void { speechLang = code; }

/** Where Kokoro audio comes from (`/api/homes/:id/tts/say`) and which voice, or null for the device's voice. */
let kokoro: { path: string; voice: string } | null = null;
export function setKokoro(path: string | null, voice: string | null): void {
  kokoro = path && voice ? { path, voice } : null;
}

const deviceCanSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const canSpeak = (): boolean => !!kokoro || deviceCanSpeak();

const clean = (text: string): string => text.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '').replace(/\s+/g, ' ').trim();

function speakOnDevice(text: string): void {
  if (!deviceCanSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLang;
  u.rate = 0.92;
  u.pitch = 1.1;
  window.speechSynthesis.speak(u);
}

// One <audio> for everything: once it has played after a tap, phones let it play again without one. It loads the
// audio straight from this server (the browser keeps it a while, so a second tap on the same 🔊 starts at once).
let player: HTMLAudioElement | null = null;

function stopAudio(): void {
  if (!player) return;
  player.pause();
  player.removeAttribute('src');
  player.load();
}

/** Plays `text` in the home's Kokoro voice; rejects when Kokoro can't (down, no voice for the language, too slow). */
function speakWithKokoro(text: string, k: NonNullable<typeof kokoro>, mine: number): Promise<void> {
  const q = new URLSearchParams({ text, lang: speechLang.slice(0, 2), v: k.voice });
  player ??= new Audio();
  const audio = player;
  audio.src = `${k.path}?${q}`;
  const listening = new AbortController();
  let timer = 0;
  return new Promise<void>((resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error('Kokoro is too slow')), 12_000);
    audio.addEventListener('playing', () => resolve(), { signal: listening.signal });
    audio.addEventListener('error', () => reject(new Error('Kokoro failed')), { signal: listening.signal });
    audio.play().catch(reject);
  }).catch((e) => {
    if (mine === turn) stopAudio();
    throw e;
  }).finally(() => {
    window.clearTimeout(timer);
    listening.abort();
  });
}

let turn = 0;

/** Says something out loud, stopping whatever was being said. Emoji are skipped. */
export function speak(text: string): void {
  const said = clean(text);
  if (!said || !canSpeak()) return;
  stopSpeaking();
  const mine = ++turn;
  if (!kokoro) { speakOnDevice(said); return; }
  speakWithKokoro(said, kokoro, mine).catch(() => {
    // Kokoro is down, has no voice for this language, or the phone wouldn't play it: the device reads instead.
    if (mine === turn) speakOnDevice(said);
  });
}

export function stopSpeaking(): void {
  turn++;
  stopAudio();
  if (deviceCanSpeak()) window.speechSynthesis.cancel();
}

/** A small 🔊 button that reads `text` out loud. */
export function SpeakButton({ text, label = 'Read it to me', className = '' }: { text: string; label?: string; className?: string }) {
  if (!canSpeak()) return null;
  return (
    <button type="button" className={`speak-btn ${className}`} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); speak(text); }}>🔊</button>
  );
}
