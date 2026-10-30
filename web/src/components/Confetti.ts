/** A burst of confetti over the whole screen. No library: one canvas, a couple of seconds, then it cleans itself up. */

interface Piece { x: number; y: number; vx: number; vy: number; size: number; color: string; spin: number; angle: number; shape: 0 | 1 | 2 }

const FALLBACK = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac', '#ffa94d'];
const DURATION = 2600;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The theme's own colors plus a rainbow, so the burst always feels part of the app. */
function palette(extra: string[]): string[] {
  const css = getComputedStyle(document.documentElement);
  const theme = ['--primary', '--ok', '--warn'].map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
  return [...extra, ...theme, ...FALLBACK];
}

/**
 * Throws confetti. `origin` is where it bursts from as a fraction of the screen (default: just below the middle),
 * `colors` lead the mix (pass a kid's color to make it theirs).
 */
export function confetti({ origin = { x: 0.5, y: 0.6 }, colors = [], count = 140 }: { origin?: { x: number; y: number }; colors?: string[]; count?: number } = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const mix = palette(colors);
  const ox = origin.x * w, oy = origin.y * h;
  const pieces: Piece[] = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 9 + Math.random() * 11;
    return {
      x: ox, y: oy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, size: 6 + Math.random() * 7,
      color: mix[Math.floor(Math.random() * mix.length)], spin: (Math.random() - 0.5) * 0.4, angle: Math.random() * Math.PI,
      shape: Math.floor(Math.random() * 3) as Piece['shape'],
    };
  });

  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = t > DURATION - 600 ? Math.max(0, (DURATION - t) / 600) : 1;
    for (const p of pieces) {
      p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.32; p.x += p.vx; p.y += p.vy; p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.angle); ctx.fillStyle = p.color;
      if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(0, -p.size / 2); ctx.lineTo(p.size / 2, p.size / 2); ctx.lineTo(-p.size / 2, p.size / 2); ctx.fill(); }
      ctx.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
