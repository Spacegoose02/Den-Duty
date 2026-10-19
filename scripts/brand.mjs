// Builds the Den Duty logo and every icon from one drawing.
//   node scripts/brand.mjs concepts   -> docs/branding/concept-*.svg + concepts.png (side-by-side review)
//   node scripts/brand.mjs            -> all icons (web, PWA, favicon, Android, Windows, Unraid) and the brand/ folder
// The raccoon head matches Nighttime Ninja's mark on purpose; the daytime version trades the chef hat for a sun
// and the night-green tile for a sunny orange one.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const out = (...p) => path.join(ROOT, ...p);

const C = {
  tile: '#e8590c',
  tileDark: '#c2410c',
  sun: '#ffd43b',
  sunDeep: '#fab005',
  fur: '#a3aab1',
  furDark: '#8d949b',
  ear: '#8d949b',
  cheek: '#f4f4f2',
  mask: '#262a2e',
  ink: '#1c1f22',
  band: '#1d3557',
};

/** The raccoon head, drawn on a 512 grid like Nighttime Ninja's icon. */
const head = ({ band = null } = {}) => `
  <circle cx="132" cy="222" r="50" fill="${C.ear}"/>
  <circle cx="380" cy="222" r="50" fill="${C.ear}"/>
  <ellipse cx="256" cy="304" rx="162" ry="134" fill="${C.fur}"/>
  <ellipse cx="256" cy="352" rx="116" ry="82" fill="${C.cheek}"/>
  <path d="M100 280 Q256 186 412 280 Q392 338 330 328 Q256 306 182 328 Q120 338 100 280Z" fill="${C.mask}"/>
  ${band ?? ''}
  <circle cx="196" cy="290" r="21" fill="#fff"/><circle cx="316" cy="290" r="21" fill="#fff"/>
  <circle cx="199" cy="291" r="11" fill="${C.ink}"/><circle cx="319" cy="291" r="11" fill="${C.ink}"/>
  <ellipse cx="256" cy="360" rx="26" ry="18" fill="${C.ink}"/>
  <path d="M220 396 Q256 420 292 396" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linecap="round"/>`;

const rays = (cx, cy, r1, r2, n, w, color) => Array.from({ length: n }, (_, i) => {
  const a = (Math.PI * 2 * i) / n - Math.PI / 2;
  const [x1, y1, x2, y2] = [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), cx + r2 * Math.cos(a), cy + r2 * Math.sin(a)];
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
}).join('');

const tile = (inner, bg = C.tile, radius = 112) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${bg}"/>${inner}</svg>`;

/** A: the sun rises behind the raccoon, where Nighttime Ninja wears its chef hat. */
const sunrise = (opts = {}) => `
  <circle cx="256" cy="160" r="90" fill="${C.sun}"/>
  ${opts.rays === false ? '' : rays(256, 160, 108, 136, 12, 20, C.sun)}
  ${head()}`;

/** B: a ninja headband with tails, and a small sun in the corner. */
const headband = () => `
  <circle cx="404" cy="104" r="44" fill="${C.sun}"/>${rays(404, 104, 58, 74, 8, 10, C.sun)}
  ${head({ band: `<path d="M118 238 Q256 158 394 238 L388 262 Q256 188 124 262Z" fill="${C.sun}"/>
    <path d="M388 246 L466 214 L448 252 L474 282 L392 262Z" fill="${C.sunDeep}"/>` })}`;

/** C: a sweeping kerchief tied on top, with a "shiny" sparkle. */
const sparkle = (x, y, s, color) => `<path d="M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}Z" fill="${color}"/>`;
const kerchief = () => `
  ${head()}
  <path d="M110 214 Q256 70 402 214 Q256 150 110 214Z" fill="${C.sun}"/>
  <path d="M236 122 L210 70 L256 96 L302 70 L276 122Z" fill="${C.sunDeep}"/>
  ${sparkle(420, 108, 46, '#fff')}${sparkle(462, 176, 20, '#fff')}`;

const CONCEPTS = { a: ['Sunrise', sunrise], b: ['Headband', headband], c: ['Sparkle kerchief', kerchief] };

async function png(svg, size, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Rasterize at the target size (2x oversampled) based on the drawing's own viewBox width.
  const vb = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1] ?? 512);
  await sharp(Buffer.from(svg), { density: Math.max(72, (72 * size * 2) / vb), limitInputPixels: false }).resize(size, size).png().toFile(file);
}

async function concepts() {
  const dir = out('docs', 'branding');
  fs.mkdirSync(dir, { recursive: true });
  const tiles = [];
  for (const [key, [name, draw]] of Object.entries(CONCEPTS)) {
    const svg = tile(draw());
    fs.writeFileSync(path.join(dir, `concept-${key}.svg`), svg);
    // Each concept at 256, 64, 32 and 16 px, the 16 and 32 scaled back up so they can be judged.
    const big = await sharp(Buffer.from(svg), { density: 144 }).resize(256, 256).png().toBuffer();
    const smalls = await Promise.all([64, 32, 16].map((s) => sharp(Buffer.from(svg), { density: 72 }).resize(s, s).png().toBuffer()));
    const up = await Promise.all(smalls.slice(1).map((b) => sharp(b).resize(64, 64, { kernel: 'nearest' }).png().toBuffer()));
    tiles.push({ big, small: [smalls[0], ...up], name });
  }
  const W = 320 * tiles.length;
  const label = (t, x) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="30"><text x="0" y="22" font-family="Segoe UI, sans-serif" font-size="20" fill="#333">${t}</text></svg>`), left: x, top: 350 });
  const comps = tiles.flatMap((t, i) => [
    { input: t.big, left: i * 320 + 32, top: 20 },
    ...t.small.map((s, j) => ({ input: s, left: i * 320 + 32 + j * 84, top: 280 })),
    label(`${String.fromCharCode(65 + i)}. ${t.name}`, i * 320 + 32),
  ]);
  await sharp({ create: { width: W, height: 390, channels: 4, background: '#ffffff' } }).composite(comps).png().toFile(path.join(dir, 'concepts.png'));
  console.log('wrote', path.join(dir, 'concepts.png'));
}

async function icons() {
  const full = tile(sunrise());
  const fullSquare = tile(sunrise(), C.tile, 0);
  // Small sizes: fewer, fatter rays so the sun still reads at 16-32 px.
  const small = tile(`<circle cx="256" cy="162" r="94" fill="${C.sun}"/>${rays(256, 162, 114, 140, 8, 26, C.sun)}${head()}`);
  const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(76 76) scale(0.703)">${sunrise()}</g></svg>`;
  const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${C.tile}"/></svg>`;
  const splash = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${bg}"/><g transform="translate(1066 1066) scale(1.172)">${full.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;

  // Web app and PWA.
  fs.writeFileSync(out('web', 'public', 'icon.svg'), full);
  await png(full, 512, out('web', 'public', 'icon.png'));
  await png(full, 192, out('web', 'public', 'icon-192.png'));
  await png(fullSquare, 512, out('web', 'public', 'icon-maskable.png'));
  await png(fullSquare, 180, out('web', 'public', 'apple-touch-icon.png'));
  const ico = await Promise.all([16, 32, 48].map((s) => sharp(Buffer.from(small), { density: 72 }).resize(s, s).png().toBuffer()));
  fs.writeFileSync(out('web', 'public', 'favicon.ico'), await pngToIco(ico));
  // Capacitor / Android sources (generate the res/ folder with @capacitor/assets, see README).
  await png(full, 1024, out('web', 'assets', 'icon-only.png'));
  await png(foreground, 1024, out('web', 'assets', 'icon-foreground.png'));
  await png(background, 1024, out('web', 'assets', 'icon-background.png'));
  await png(splash('#fff9ec'), 2732, out('web', 'assets', 'splash.png'));
  await png(splash('#1c1f22'), 2732, out('web', 'assets', 'splash-dark.png'));
  // Windows (electron-builder wants at least 256 px).
  await png(full, 512, out('apps', 'desktop', 'build', 'icon.png'));
  fs.writeFileSync(out('apps', 'launcher', 'icon.svg'), full);
  // Brand masters.
  fs.writeFileSync(out('docs', 'branding', 'den-duty-logo.svg'), full);
  fs.writeFileSync(out('docs', 'branding', 'den-duty-logo-small.svg'), small);
  await brandFolder({ full, fullSquare, small, foreground, background });
  console.log('icons written');
}

/** The top-level brand/ folder: every logo, icon, wordmark and character, ready to hand to anyone. */
async function brandFolder({ full, fullSquare, small, foreground, background }) {
  const b = (...p) => out('brand', ...p);
  fs.rmSync(out('brand', 'logo'), { recursive: true, force: true });
  fs.mkdirSync(b('logo', 'png'), { recursive: true });
  fs.writeFileSync(b('logo', 'den-duty-logo.svg'), full);
  fs.writeFileSync(b('logo', 'den-duty-logo-small.svg'), small);
  fs.writeFileSync(b('logo', 'den-duty-logo-square.svg'), fullSquare);
  for (const s of [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024]) await png(s <= 32 ? small : full, s, b('logo', 'png', `den-duty-${s}.png`));
  // favicon (16/32/48) and the Windows icon (16-256).
  const icoOf = async (sizes) => pngToIco(await Promise.all(sizes.map((s) => sharp(Buffer.from(s <= 32 ? small : full), { density: Math.max(72, (72 * s * 2) / 512) }).resize(s, s).png().toBuffer())));
  fs.writeFileSync(b('favicon.ico'), await icoOf([16, 32, 48]));
  fs.mkdirSync(b('app-icons', 'windows'), { recursive: true });
  fs.writeFileSync(b('app-icons', 'windows', 'den-duty.ico'), await icoOf([16, 24, 32, 48, 64, 128, 256]));
  // Android adaptive icon (foreground on a solid background, 108dp safe zone) and legacy launcher icon.
  await png(foreground, 1024, b('app-icons', 'android', 'adaptive-foreground.png'));
  await png(background, 1024, b('app-icons', 'android', 'adaptive-background.png'));
  await png(full, 512, b('app-icons', 'android', 'play-store-512.png'));
  for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) await png(full, s, b('app-icons', 'android', `ic_launcher-${d}.png`));
  // PWA (regular + maskable) and Apple touch icon.
  await png(full, 192, b('app-icons', 'pwa', 'icon-192.png'));
  await png(full, 512, b('app-icons', 'pwa', 'icon-512.png'));
  await png(fullSquare, 512, b('app-icons', 'pwa', 'icon-maskable-512.png'));
  await png(fullSquare, 180, b('app-icons', 'apple', 'apple-touch-icon-180.png'));
  // Unraid (Community Applications shows it on a dark or light card; a rounded tile reads on both).
  await png(full, 512, b('unraid', 'den-duty-unraid.png'));
  // Wordmark and lockups, light (dark text) and dark (light text).
  const inner = full.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const font = `font-family="'Nunito', 'Segoe UI Rounded', 'Arial Rounded MT Bold', 'Segoe UI', Arial, sans-serif" font-weight="900"`;
  const word = (ink, accent) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 260"><text x="0" y="200" ${font} font-size="200" fill="${ink}">Den <tspan fill="${accent}">Duty</tspan></text></svg>`;
  const horizontal = (ink, accent) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400"><svg x="0" y="0" width="400" height="400" viewBox="0 0 512 512">${inner}</svg><text x="460" y="268" ${font} font-size="200" fill="${ink}">Den <tspan fill="${accent}">Duty</tspan></text></svg>`;
  const stacked = (ink, accent) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900"><svg x="200" y="40" width="500" height="500" viewBox="0 0 512 512">${inner}</svg><text x="450" y="780" text-anchor="middle" ${font} font-size="190" fill="${ink}">Den <tspan fill="${accent}">Duty</tspan></text></svg>`;
  const raster = async (svg, w, h, file, bg) => {
    const img = sharp(Buffer.from(svg), { density: 300 }).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    await (bg ? img.flatten({ background: bg }) : img).png().toFile(file);
  };
  fs.mkdirSync(b('wordmark'), { recursive: true });
  for (const [mode, ink, accent, bg] of [['light', C.ink, C.tile, null], ['dark', '#ffffff', C.sun, null]]) {
    for (const [name, svg, w, h] of [['wordmark', word(ink, accent), 1200, 260], ['lockup-horizontal', horizontal(ink, accent), 1600, 400], ['lockup-stacked', stacked(ink, accent), 900, 900]]) {
      fs.writeFileSync(b('wordmark', `den-duty-${name}-${mode}.svg`), svg);
      await raster(svg, w, h, b('wordmark', `den-duty-${name}-${mode}.png`), bg);
    }
  }
  // Social / README banner on the sunny background.
  const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640"><rect width="1280" height="640" fill="#fff9ec"/><svg x="110" y="170" width="300" height="300" viewBox="0 0 512 512">${inner}</svg><text x="460" y="330" ${font} font-size="130" fill="${C.ink}">Den <tspan fill="${C.tile}">Duty</tspan></text><text x="464" y="400" font-family="'Segoe UI', Arial, sans-serif" font-size="34" fill="#5c636a">Chores, points and goals for the whole den</text></svg>`;
  fs.writeFileSync(b('social-banner.svg'), banner);
  await raster(banner, 1280, 640, b('social-banner.png'));
  // Characters: the raccoon avatars and Dr. Bandit, rendered from the app's own components.
  const { renderCharacters } = await import('./avatars.mjs');
  await renderCharacters(b('characters'));
}

if (process.argv[2] === 'concepts') await concepts();
else await icons();
