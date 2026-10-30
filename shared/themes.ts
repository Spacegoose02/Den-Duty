// Every theme in one place: the server validates ids against this list and the app builds its CSS from it.
// Add a theme by adding an entry. Colors on --primary must stay readable with --on-primary text.

export interface ThemeDef {
  id: string;
  name: string;
  dark: boolean;
  /** For kids' pickers: what it's like. */
  vibe: string;
  bg: string; surface: string; surface2: string; text: string; muted: string; border: string;
  primary: string; primaryStrong: string; onPrimary: string;
  danger: string; warn: string; ok: string;
  /** Welcome-scene colors. */
  sky: string; grass: string; dust: string;
}

const light = { danger: '#c0392b', warn: '#c98a00', ok: '#2b8a3e', surface: '#ffffff', onPrimary: '#ffffff', dark: false };
const dark = { danger: '#ff8787', warn: '#ffd43b', ok: '#8ce99a', dark: true };

export const THEME_DEFS: ThemeDef[] = [
  { ...light, id: 'sunny', name: 'Sunny', vibe: 'Bright and warm', bg: '#fff9ec', surface2: '#fff0cc', text: '#2b2108', muted: '#7a6a45', border: '#f1e1b8', primary: '#e8590c', primaryStrong: '#c2410c', sky: '#d0ebff', grass: '#8ce99a', dust: 'rgba(140,110,70,.45)' },
  { ...light, id: 'meadow', name: 'Meadow', vibe: 'Fresh green grass', bg: '#f1f9f3', surface2: '#dff2e5', text: '#13261a', muted: '#557060', border: '#cfe6d6', primary: '#2f9e6e', primaryStrong: '#237c56', sky: '#e3f6ff', grass: '#69db7c', dust: 'rgba(110,120,90,.45)' },
  { ...light, id: 'forest', name: 'Forest', vibe: 'Deep woods', bg: '#f3f7f2', surface2: '#e8f1e6', text: '#17261c', muted: '#5d6f62', border: '#d3e2d0', primary: '#2f7d4f', primaryStrong: '#22603b', sky: '#dbeedd', grass: '#5c9e6a', dust: 'rgba(90,110,80,.45)' },
  { ...light, id: 'sky', name: 'Sky', vibe: 'Clear blue day', bg: '#f2f7fc', surface2: '#e0edf8', text: '#0f2233', muted: '#536b80', border: '#cfe0ee', primary: '#1f6fb2', primaryStrong: '#175890', sky: '#a5d8ff', grass: '#8ce99a', dust: 'rgba(100,110,130,.4)' },
  { ...light, id: 'ocean', name: 'Ocean', vibe: 'Waves and sand', bg: '#effaff', surface2: '#d9f1fb', text: '#0b2a3a', muted: '#4f7486', border: '#c5e6f3', primary: '#0b7285', primaryStrong: '#095c6b', sky: '#99e9f2', grass: '#ffe8a1', dust: 'rgba(120,100,60,.4)' },
  { ...light, id: 'arctic', name: 'Arctic', vibe: 'Snow and ice', bg: '#f5fafe', surface2: '#e6f2fb', text: '#102231', muted: '#587085', border: '#d4e6f3', primary: '#1c7ed6', primaryStrong: '#1864ab', sky: '#e7f5ff', grass: '#f1f3f5', dust: 'rgba(120,140,160,.4)' },
  { ...light, id: 'mint', name: 'Mint', vibe: 'Cool and calm', bg: '#f0fbf7', surface2: '#d3f5e8', text: '#0f2e24', muted: '#4e7a6b', border: '#bfe9d8', primary: '#0ca678', primaryStrong: '#099268', sky: '#c3fae8', grass: '#8ce99a', dust: 'rgba(80,120,100,.4)' },
  { ...light, id: 'dino', name: 'Dino', vibe: 'Jungle stomp', bg: '#f6f9ec', surface2: '#e9f2cf', text: '#24301a', muted: '#66734f', border: '#d9e6b5', primary: '#5c940d', primaryStrong: '#4a7a08', sky: '#fff3bf', grass: '#94d82d', dust: 'rgba(120,90,40,.45)' },
  { ...light, id: 'sports', name: 'Sports', vibe: 'Game day', bg: '#f4f6f8', surface2: '#e3e8ee', text: '#14202b', muted: '#56677a', border: '#cfd8e2', primary: '#1864ab', primaryStrong: '#134f87', danger: '#e03131', sky: '#d0ebff', grass: '#51cf66', dust: 'rgba(80,90,100,.4)' },
  { ...light, id: 'candy', name: 'Candy', vibe: 'Sweet and pink', bg: '#fff4fb', surface2: '#ffe3f3', text: '#3b1230', muted: '#8a5a7c', border: '#fbd0ea', primary: '#d6336c', primaryStrong: '#a61e4d', sky: '#e5dbff', grass: '#c3fae8', dust: 'rgba(230,73,128,.35)' },
  { ...light, id: 'berry', name: 'Berry', vibe: 'Purple jam', bg: '#fbf5fa', surface2: '#f3e3f0', text: '#2a1427', muted: '#76566f', border: '#ead2e5', primary: '#8e2c7a', primaryStrong: '#6f1f5f', sky: '#fde2f3', grass: '#b2f2bb', dust: 'rgba(130,100,125,.4)' },
  { ...light, id: 'lavender', name: 'Lavender', vibe: 'Soft and dreamy', bg: '#f8f5ff', surface2: '#ece5ff', text: '#24173f', muted: '#6d5f8a', border: '#ddd2f7', primary: '#7048e8', primaryStrong: '#5f3dc4', sky: '#e5dbff', grass: '#d3f9d8', dust: 'rgba(110,90,150,.4)' },
  { ...light, id: 'sunset', name: 'Sunset', vibe: 'Orange evening', bg: '#fff5f0', surface2: '#ffe4d6', text: '#3a1a10', muted: '#8a5a48', border: '#fbd3c0', primary: '#d9480f', primaryStrong: '#b03a0c', sky: '#ffc9c9', grass: '#ffd8a8', dust: 'rgba(150,90,60,.4)' },
  { ...light, id: 'lemonade', name: 'Lemonade', vibe: 'Zingy yellow', bg: '#fffde8', surface2: '#fff6bf', text: '#2e2a0a', muted: '#77703a', border: '#f5ea9c', primary: '#c25e00', primaryStrong: '#a34f00', sky: '#fff9db', grass: '#c0eb75', dust: 'rgba(130,120,50,.4)' },
  { ...dark, id: 'raccoon', name: 'Raccoon', vibe: 'Masked and sneaky', bg: '#1c1f22', surface: '#262a2e', surface2: '#30353a', text: '#eceff1', muted: '#a3aab1', border: '#3a4046', primary: '#ffa94d', primaryStrong: '#ffc078', onPrimary: '#1c1f22', sky: '#2b3a4a', grass: '#2f5d3a', dust: 'rgba(230,235,240,.3)' },
  { ...dark, id: 'night', name: 'Night', vibe: 'Moon and stars', bg: '#0f1420', surface: '#182033', surface2: '#212b42', text: '#e6ebf5', muted: '#9aa6c0', border: '#2c3754', primary: '#ffd43b', primaryStrong: '#ffe066', onPrimary: '#1a1f2b', sky: '#1b2a4a', grass: '#24452f', dust: 'rgba(220,230,255,.3)' },
  { ...dark, id: 'midnight', name: 'Midnight', vibe: 'Dark forest', bg: '#0f1612', surface: '#17211b', surface2: '#1f2c24', text: '#e5efe7', muted: '#9fb3a6', border: '#2c3d32', primary: '#4fbf7d', primaryStrong: '#6fd697', onPrimary: '#08130c', sky: '#1c2a22', grass: '#26382d', dust: 'rgba(220,235,225,.35)' },
  { ...dark, id: 'space', name: 'Space', vibe: 'Rockets and planets', bg: '#0b0d1e', surface: '#15183a', surface2: '#1f2350', text: '#edf0ff', muted: '#a3a9d9', border: '#2c3170', primary: '#9775fa', primaryStrong: '#b197fc', onPrimary: '#0b0d1e', ok: '#69db7c', sky: '#1a1d4a', grass: '#3b2f6b', dust: 'rgba(255,255,255,.4)' },
  { ...dark, id: 'volcano', name: 'Volcano', vibe: 'Hot lava', bg: '#1d1210', surface: '#2a1a16', surface2: '#3a231d', text: '#fbeee8', muted: '#c9a89c', border: '#4d2f27', primary: '#ff6b35', primaryStrong: '#ff8c5a', onPrimary: '#1d1210', sky: '#3d1f1a', grass: '#4a2a1f', dust: 'rgba(255,200,170,.35)' },
  { ...light, id: 'glam', name: 'Glam', vibe: 'Hot pink dream house', bg: '#fff0f7', surface2: '#ffd9ec', text: '#4a0d2e', muted: '#8f4a6e', border: '#ffc2e0', primary: '#d91a7f', primaryStrong: '#a8125f', sky: '#ffd6f0', grass: '#ffb3d9', dust: 'rgba(217,26,127,.35)' },
  { ...light, id: 'clubhouse', name: 'Clubhouse', vibe: 'Red, yellow and round ears', bg: '#fffbea', surface2: '#fff0b3', text: '#1a1a1a', muted: '#6b5a2a', border: '#f2dc8a', primary: '#d62828', primaryStrong: '#a61e1e', warn: '#b07800', sky: '#bde0fe', grass: '#7ac74f', dust: 'rgba(30,30,30,.35)' },
  { ...light, id: 'blocky', name: 'Blocky', vibe: 'Dig, build and craft', bg: '#eef5e6', surface2: '#dcead0', text: '#2b1d0e', muted: '#6b5a40', border: '#c9b48c', primary: '#4f7f2a', primaryStrong: '#3a6219', sky: '#9ccfff', grass: '#6aa84f', dust: 'rgba(120,85,50,.5)' },
  { ...light, id: 'obby', name: 'Obby', vibe: 'Jump, climb, win', bg: '#f2f4f7', surface2: '#e2e6ec', text: '#111827', muted: '#4b5563', border: '#cfd5de', primary: '#e0201a', primaryStrong: '#b3160f', sky: '#bfe3ff', grass: '#4ade80', dust: 'rgba(60,70,90,.4)' },
  { ...dark, id: 'toxic', name: 'Toxic', vibe: 'Glowing green goo', bg: '#0c1309', surface: '#141f10', surface2: '#1c2c16', text: '#eaffd9', muted: '#9fbf8a', border: '#2b4222', primary: '#a3ff12', primaryStrong: '#c6ff66', onPrimary: '#0c1309', warn: '#ffe600', sky: '#13240d', grass: '#3d6b12', dust: 'rgba(163,255,18,.4)' },
  { ...dark, id: 'storm', name: 'Storm', vibe: 'Thunder and lightning', bg: '#141922', surface: '#1d2430', surface2: '#27303f', text: '#e8eef7', muted: '#9aa8bd', border: '#323d50', primary: '#5cc8ff', primaryStrong: '#8fdcff', onPrimary: '#0b1220', warn: '#ffd43b', sky: '#2a3446', grass: '#2e3b33', dust: 'rgba(200,220,255,.35)' },
  { id: 'contrast', name: 'High contrast', vibe: 'Extra easy to read', dark: false, bg: '#ffffff', surface: '#ffffff', surface2: '#eeeeee', text: '#000000', muted: '#222222', border: '#000000', primary: '#0033cc', primaryStrong: '#001f80', onPrimary: '#ffffff', danger: '#b00000', warn: '#7a4b00', ok: '#006400', sky: '#ffffff', grass: '#dddddd', dust: 'rgba(0,0,0,.5)' },
  { id: 'contrast-dark', name: 'High contrast dark', vibe: 'Extra easy to read, dark', dark: true, bg: '#000000', surface: '#000000', surface2: '#1a1a1a', text: '#ffffff', muted: '#e6e6e6', border: '#ffffff', primary: '#ffd400', primaryStrong: '#ffe666', onPrimary: '#000000', danger: '#ff6b6b', warn: '#ffd400', ok: '#5cff5c', sky: '#000000', grass: '#333333', dust: 'rgba(255,255,255,.5)' },
];

export const THEME_IDS = THEME_DEFS.map((t) => t.id);
export const DEFAULT_THEME = 'sunny';

export const isThemeId = (v: unknown): v is string => typeof v === 'string' && THEME_IDS.includes(v);

/** CSS variable blocks for every theme, keyed by [data-theme]. */
export function themeCss(): string {
  return THEME_DEFS.map((t) => `${t.id === DEFAULT_THEME ? ':root,\n' : ''}[data-theme='${t.id}'] {
  color-scheme: ${t.dark ? 'dark' : 'light'};
  --bg: ${t.bg}; --surface: ${t.surface}; --surface-2: ${t.surface2}; --text: ${t.text}; --muted: ${t.muted}; --border: ${t.border};
  --primary: ${t.primary}; --primary-strong: ${t.primaryStrong}; --on-primary: ${t.onPrimary};
  --danger: ${t.danger}; --warn: ${t.warn}; --ok: ${t.ok};
  --scene-sky: ${t.sky}; --scene-grass: ${t.grass}; --scene-dust: ${t.dust};
}`).join('\n');
}
