// Read-aloud for kids who can't read yet: the browser's own speech, nothing leaves the device.

export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Says something out loud, stopping whatever was being said. Emoji are skipped. */
export function speak(text: string): void {
  if (!canSpeak() || !text.trim()) return;
  const clean = text.replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 0.92;
  u.pitch = 1.1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** A small 🔊 button that reads `text` out loud. */
export function SpeakButton({ text, label = 'Read it to me', className = '' }: { text: string; label?: string; className?: string }) {
  if (!canSpeak()) return null;
  return (
    <button type="button" className={`speak-btn ${className}`} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); speak(text); }}>🔊</button>
  );
}
