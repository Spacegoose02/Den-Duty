// Renders the raccoon avatars and Dr. Bandit from the app's own React components into brand/characters/ (SVG + PNG),
// so the brand art always matches what's on screen. Called by scripts/brand.mjs; uses Vite to load the TSX.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const WEB = path.join(ROOT, 'web');
const require = createRequire(path.join(WEB, 'package.json'));

export async function renderCharacters(outDir) {
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const vite = await createServer({ root: WEB, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', configFile: false });
  try {
    const { RaccoonAvatar, DoctorRaccoon } = await vite.ssrLoadModule('/src/components/Raccoon.tsx');
    const { AVATARS, AVATAR_LABELS } = await vite.ssrLoadModule('/../shared/catalog.ts');
    fs.mkdirSync(path.join(outDir, 'avatars'), { recursive: true });
    const write = async (file, el) => {
      let svg = renderToStaticMarkup(el);
      if (!svg.includes('xmlns=')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      fs.writeFileSync(`${file}.svg`, svg);
      await sharp(Buffer.from(svg), { density: 600 }).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`${file}.png`);
    };
    for (const a of AVATARS) await write(path.join(outDir, 'avatars', `raccoon-${a}`), React.createElement(RaccoonAvatar, { variant: a, size: 512, title: AVATAR_LABELS[a] }));
    await write(path.join(outDir, 'dr-bandit'), React.createElement(DoctorRaccoon, { size: 512, title: 'Dr. Bandit' }));
    return AVATARS.length;
  } finally {
    await vite.close();
  }
}
