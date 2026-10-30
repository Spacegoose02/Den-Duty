// The Den Duty mascot: a masked raccoon, drawn in plain SVG so it themes and scales cleanly.
// Avatars are sticker-style badges: each variant has its own background, outfit and expression so kids can tell
// them apart at a glance, even at 20px in a table row.
import { useId } from 'react';
import { AVATAR_LABELS, isAvatar, type Avatar } from '../../../shared/catalog.ts';

const INK = '#2b2f38';
const MOUTH = '#8c2232';
const BLUSH = '#ff8fab';

type Fur = { light: string; fur: string; dark: string; ear: string; muzzle: string; mask: string };
const GREY: Fur = { light: '#c9d0d7', fur: '#a9b2bc', dark: '#6c7581', ear: '#5c6470', muzzle: '#fbfaf7', mask: '#3a404a' };
const GOLD: Fur = { light: '#ffe08a', fur: '#f5c75b', dark: '#c98a1a', ear: '#b97813', muzzle: '#fff8e6', mask: '#7a4a0c' };

type Eyes = 'open' | 'happy' | 'wink' | 'determined' | 'star' | 'wide';
type Mouth = 'smile' | 'grin' | 'smirk' | 'o';

/** How each avatar looks: badge colors (light center, outer edge), expression and fur. */
const LOOKS: Record<Avatar, { bg: [string, string]; eyes: Eyes; mouth: Mouth; fur?: Fur }> = {
  classic: { bg: ['#d3f9d8', '#69db7c'], eyes: 'open', mouth: 'smile' },
  ninja: { bg: ['#ffe8cc', '#ff922b'], eyes: 'determined', mouth: 'smirk' },
  bandana: { bg: ['#fff3bf', '#fcc419'], eyes: 'wink', mouth: 'grin' },
  glasses: { bg: ['#e3fafc', '#66d9e8'], eyes: 'open', mouth: 'smile' },
  cap: { bg: ['#f4fce3', '#94d82d'], eyes: 'open', mouth: 'grin' },
  crown: { bg: ['#f3f0ff', '#b197fc'], eyes: 'happy', mouth: 'smile' },
  bow: { bg: ['#fff0f6', '#faa2c1'], eyes: 'happy', mouth: 'grin' },
  headphones: { bg: ['#e6fcf5', '#38d9a9'], eyes: 'happy', mouth: 'smile' },
  party: { bg: ['#fff5f5', '#ff8787'], eyes: 'open', mouth: 'grin' },
  pirate: { bg: ['#d0ebff', '#339af0'], eyes: 'open', mouth: 'grin' },
  wizard: { bg: ['#7950f2', '#3b1f8f'], eyes: 'wide', mouth: 'o' },
  astronaut: { bg: ['#3b4a7a', '#141c38'], eyes: 'wide', mouth: 'o' },
  superhero: { bg: ['#dbe4ff', '#5c7cfa'], eyes: 'determined', mouth: 'grin' },
  golden: { bg: ['#fff9db', '#fab005'], eyes: 'star', mouth: 'grin', fur: GOLD },
};

/** SVG ids must be unique per drawing on the page; useId's punctuation isn't safe inside url(#...). */
const useSvgId = () => `rc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

const star = (cx: number, cy: number, r: number) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    const d = i % 2 ? r * 0.45 : r;
    return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
  });
  return `M${pts.join('L')}Z`;
};

function Eye({ x, y, kind }: { x: number; y: number; kind: Eyes | 'closed' }) {
  if (kind === 'happy' || kind === 'closed') {
    return <path d={`M${x - 6} ${y + 2} q6 -9 12 0`} stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
  }
  if (kind === 'star') {
    return (
      <g>
        <circle cx={x} cy={y} r="8.5" fill="#fff" />
        <path d={star(x, y + 0.5, 7.5)} fill="#f59f00" stroke="#e67700" strokeWidth="1" strokeLinejoin="round" />
        <circle cx={x - 2.2} cy={y - 2} r="1.4" fill="#fff" />
      </g>
    );
  }
  const wide = kind === 'wide';
  return (
    <g>
      <circle cx={x} cy={y} r={wide ? 9.5 : 8.5} fill="#fff" />
      <circle cx={x + 0.6} cy={y + 0.9} r={wide ? 5 : 6.2} fill="#1d2230" />
      <circle cx={x - 1.6} cy={y - 1.8} r="2.4" fill="#fff" />
      <circle cx={x + 2.6} cy={y + 2.6} r="1.1" fill="#fff" />
    </g>
  );
}

function MouthShape({ kind }: { kind: Mouth }) {
  if (kind === 'grin') {
    return (
      <g>
        <path d="M50.5 86 h19 q-1.5 12 -9.5 12 q-8 0 -9.5 -12z" fill={MOUTH} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M54.5 93.5 q5.5 -4 11 0 q-1.5 3.6 -5.5 3.6 q-4 0 -5.5 -3.6z" fill="#ff8fa3" />
        <rect x="56.5" y="86.5" width="7" height="3.6" rx="1" fill="#fff" />
      </g>
    );
  }
  if (kind === 'smirk') return <path d="M52 89 q9 5 16 -3" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  if (kind === 'o') return <ellipse cx="60" cy="91" rx="4" ry="5" fill={MOUTH} stroke={INK} strokeWidth="1.8" />;
  return <path d="M60 83 v3 M52 86.5 q4 5 8 0 q4 5 8 0" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

/** The raccoon's head on the 120 grid, centred at (60, 66). Used bare in scenes and inside the avatar badge. */
function Head({ variant }: { variant: Avatar }) {
  const uid = useSvgId();
  const look = LOOKS[variant];
  const f = look.fur ?? GREY;
  const mask = variant === 'superhero' ? '#e03131' : f.mask;
  const leftEye: Eyes | 'closed' = look.eyes;
  const rightEye: Eyes | 'closed' = look.eyes === 'wink' ? 'closed' : look.eyes;
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-fur`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={f.light} />
          <stop offset="1" stopColor={f.fur} />
        </linearGradient>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe066" />
          <stop offset="1" stopColor="#f59f00" />
        </linearGradient>
      </defs>
      {/* ears */}
      <g stroke={INK} strokeWidth="2.5">
        <ellipse cx="28" cy="38" rx="14" ry="15" fill={f.ear} transform="rotate(-18 28 38)" />
        <ellipse cx="92" cy="38" rx="14" ry="15" fill={f.ear} transform="rotate(18 92 38)" />
      </g>
      <ellipse cx="29" cy="40" rx="7" ry="8" fill="#f1c4cf" transform="rotate(-18 29 40)" />
      <ellipse cx="91" cy="40" rx="7" ry="8" fill="#f1c4cf" transform="rotate(18 91 40)" />
      {/* fluffy cheek tufts */}
      <path d="M25 64 l-13 4 l9 5 l-11 6 l15 4z M95 64 l13 4 l-9 5 l11 6 l-15 4z" fill={f.fur} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      {/* head */}
      <ellipse cx="60" cy="66" rx="40" ry="34" fill={`url(#${uid}-fur)`} stroke={INK} strokeWidth="2.5" />
      <path d="M60 33 q-7 9 0 20 q7 -11 0 -20z" fill={f.dark} />
      {/* white muzzle and brows */}
      <path d="M30 80 q2 -14 18 -12 q12 4 24 0 q16 -2 18 12 q-2 18 -30 19 q-28 -1 -30 -19z" fill={f.muzzle} />
      <path d="M33 47 q8 -6 16 -2 M87 47 q-8 -6 -16 -2" stroke={f.muzzle} strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* the bandit mask */}
      <path d="M19 60 q6 -18 22 -14 q11 3 19 8 q8 -5 19 -8 q16 -4 22 14 q-3 16 -20 16 q-12 -1 -21 -8 q-9 7 -21 8 q-17 0 -20 -16z" fill={mask} />
      {look.eyes === 'determined' && (
        <path d="M33 43 l15 6 M87 43 l-15 6" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
      )}
      <Eye x={43} y={61} kind={leftEye} />
      <Eye x={77} y={61} kind={rightEye} />
      {/* blush, nose and mouth */}
      <ellipse cx="38" cy="83" rx="6" ry="3.6" fill={BLUSH} opacity="0.6" />
      <ellipse cx="82" cy="83" rx="6" ry="3.6" fill={BLUSH} opacity="0.6" />
      <path d="M52.5 76 q7.5 -4.5 15 0 q-1.5 6.5 -7.5 7.5 q-6 -1 -7.5 -7.5z" fill={INK} />
      <ellipse cx="57.5" cy="76.6" rx="2.6" ry="1.3" fill="#fff" opacity="0.7" />
      <MouthShape kind={look.mouth} />
      <Gear variant={variant} uid={uid} />
    </g>
  );
}

const sparkle = (x: number, y: number, s: number) =>
  `M${x} ${y - s} Q${x + s * 0.2} ${y - s * 0.2} ${x + s} ${y} Q${x + s * 0.2} ${y + s * 0.2} ${x} ${y + s} Q${x - s * 0.2} ${y + s * 0.2} ${x - s} ${y} Q${x - s * 0.2} ${y - s * 0.2} ${x} ${y - s}Z`;

/** Hats, glasses and the like, drawn over the head. */
function Gear({ variant, uid }: { variant: Avatar; uid: string }) {
  switch (variant) {
    case 'ninja':
      return (
        <g stroke={INK} strokeWidth="2.2" strokeLinejoin="round">
          <path d="M100 51 q12 -10 19 -5 q-8 3 -15 10z M100 54 q13 1 16 10 q-9 -4 -16 -5z" fill="#274b77" />
          <path d="M21 49 q39 -25 78 0 l-1.5 10 q-37.5 -23 -75 0z" fill="#1d3557" />
          <circle cx="100" cy="53" r="4" fill="#1d3557" />
          <rect x="51" y="35" width="18" height="10" rx="2.5" fill="#ced4da" transform="rotate(0)" />
          <path d={star(60, 40.2, 3.6)} fill="#495057" stroke="none" />
        </g>
      );
    case 'bandana':
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M33 95 q27 12 54 0 l-27 23z" fill="#e03131" />
          <g fill="#fff" stroke="none">
            <circle cx="47" cy="102" r="1.9" /><circle cx="60" cy="104" r="1.9" /><circle cx="73" cy="102" r="1.9" /><circle cx="60" cy="111" r="1.9" />
          </g>
        </g>
      );
    case 'glasses':
      return (
        <g>
          <g fill="rgba(255,255,255,.18)" stroke="#5c3d1e" strokeWidth="3.2">
            <circle cx="43" cy="61" r="11.5" />
            <circle cx="77" cy="61" r="11.5" />
          </g>
          <path d="M54.5 60 q5.5 -4 11 0 M31.5 58 l-10 -4 M88.5 58 l10 -4" stroke="#5c3d1e" strokeWidth="3.2" fill="none" strokeLinecap="round" />
          <path d="M60 104 l-11 -6 v12z M60 104 l11 -6 v12z" fill="#e03131" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="60" cy="104" r="3.4" fill="#c92a2a" stroke={INK} strokeWidth="2" />
        </g>
      );
    case 'cap':
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M80 41 q22 -6 33 3 q-5 7 -33 3z" fill="#c92a2a" />
          <path d="M30 45 q1 -32 30 -32 q29 0 30 32 q-30 -9 -60 0z" fill="#f03e3e" />
          <path d="M60 14 q-5 14 -3 29" stroke="#c92a2a" strokeWidth="2" fill="none" />
          <path d={star(45, 31, 5.5)} fill="#fff" stroke="none" />
          <circle cx="60" cy="13" r="3.4" fill="#c92a2a" strokeWidth="1.8" />
        </g>
      );
    case 'crown':
      return <Crown uid={uid} />;
    case 'golden':
      return (
        <g>
          <Crown uid={uid} />
          <g fill="#fff" stroke="#f59f00" strokeWidth="1.2">
            <path d={sparkle(14, 26, 7)} /><path d={sparkle(108, 20, 6)} /><path d={sparkle(106, 92, 4.5)} />
          </g>
        </g>
      );
    case 'bow':
      return (
        <g stroke={INK} strokeWidth="2.2" strokeLinejoin="round" transform="rotate(-12 76 28)">
          <path d="M76 28 q-20 -18 -22 -2 q0 14 22 2z" fill="#f06595" />
          <path d="M76 28 q20 -18 22 -2 q0 14 -22 2z" fill="#f06595" />
          <g fill="#fff" stroke="none"><circle cx="62" cy="24" r="1.8" /><circle cx="65" cy="31" r="1.5" /><circle cx="90" cy="24" r="1.8" /><circle cx="87" cy="31" r="1.5" /></g>
          <circle cx="76" cy="28" r="5" fill="#d6336c" />
        </g>
      );
    case 'headphones':
      return (
        <g>
          <path d="M19 64 q0 -55 41 -55 q41 0 41 55" fill="none" stroke={INK} strokeWidth="9.5" strokeLinecap="round" />
          <path d="M19 64 q0 -55 41 -55 q41 0 41 55" fill="none" stroke="#495057" strokeWidth="5" strokeLinecap="round" />
          <g stroke={INK} strokeWidth="2.5">
            <rect x="9" y="52" width="17" height="27" rx="8.5" fill="#f06595" />
            <rect x="94" y="52" width="17" height="27" rx="8.5" fill="#f06595" />
          </g>
          <rect x="13" y="58" width="4" height="15" rx="2" fill="#fff" opacity="0.5" />
          <rect x="98" y="58" width="4" height="15" rx="2" fill="#fff" opacity="0.5" />
        </g>
      );
    case 'party':
      return (
        <g stroke={INK} strokeWidth="2.2" strokeLinejoin="round" transform="rotate(14 60 34)">
          <path d="M60 -1 l-17 36 q17 6 34 0z" fill="#4dabf7" />
          <g fill="#ffd43b" stroke="none"><circle cx="55" cy="25" r="2.6" /><circle cx="63" cy="14" r="2.4" /><circle cx="66" cy="28" r="2.6" /><circle cx="58" cy="7" r="1.6" /></g>
          <path d="M45 31 q15 5 30 0" stroke="#ff6b6b" strokeWidth="3" fill="none" />
          <circle cx="60" cy="-2" r="5" fill="#ffd43b" />
        </g>
      );
    case 'pirate':
      return (
        <g>
          <path d="M23 47 Q50 50 77 61 L99 70" stroke={INK} strokeWidth="2.6" fill="none" />
          <ellipse cx="77" cy="61.5" rx="10.5" ry="9.5" fill="#212529" stroke={INK} strokeWidth="1.5" />
          <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
            <path d="M16 47 q8 -12 20 -9 q7 -25 24 -25 q17 0 24 25 q12 -3 20 9 q-44 -11 -88 0z" fill="#25282d" />
          </g>
          <path d="M21 45 q39 -9 78 0" stroke="#fcc419" strokeWidth="2.5" fill="none" />
          <path d="M53 37 l14 -4 M53 33 l14 4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="60" cy="27" r="5.5" fill="#fff" />
          <circle cx="58" cy="27" r="1.3" fill="#25282d" /><circle cx="62" cy="27" r="1.3" fill="#25282d" />
        </g>
      );
    case 'wizard':
      return (
        <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M36 42 L56 2 q7 -8 15 -2 q-7 0 -8 6 L84 42z" fill="#4263eb" />
          <ellipse cx="60" cy="42" rx="33" ry="6.5" fill="#364fc7" />
          <path d={star(60, 26, 6)} fill="#ffd43b" strokeWidth="1.4" />
          <path d={sparkle(70, 13, 3)} fill="#ffd43b" stroke="none" />
          <path d={sparkle(50, 36, 2.4)} fill="#ffd43b" stroke="none" />
        </g>
      );
    case 'astronaut':
      return (
        <g>
          <circle cx="60" cy="62" r="50" fill="rgba(208,235,255,.22)" stroke="#e9ecef" strokeWidth="5" />
          <circle cx="60" cy="62" r="52.5" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M26 34 q13 -16 32 -18" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" opacity="0.85" />
          <circle cx="92" cy="96" r="3" fill="#fff" opacity="0.7" />
        </g>
      );
    case 'superhero':
      return <path d="M100 58 q10 -4 16 2 q-8 0 -14 6 M100 62 q8 6 12 14 q-7 -6 -13 -8" fill="#e03131" stroke={INK} strokeWidth="2" strokeLinejoin="round" />;
    default:
      return null;
  }
}

function Crown({ uid }: { uid: string }) {
  return (
    <g stroke={INK} strokeWidth="2.4" strokeLinejoin="round">
      <path d="M36 41 l2 -25 l12 12 l10 -17 l10 17 l12 -12 l2 25 q-24 -6 -48 0z" fill={`url(#${uid}-gold)`} />
      <g strokeWidth="1.6">
        <circle cx="38" cy="15" r="2.8" fill="#fff3bf" /><circle cx="60" cy="10" r="2.8" fill="#fff3bf" /><circle cx="82" cy="15" r="2.8" fill="#fff3bf" />
        <circle cx="60" cy="31" r="4" fill="#e03131" /><circle cx="46" cy="34" r="2.8" fill="#1c7ed6" /><circle cx="74" cy="34" r="2.8" fill="#2f9e44" />
      </g>
    </g>
  );
}

/** Shoulders and outfit under the head, only on the avatar badge. Drawn on the head's grid. */
function Outfit({ variant }: { variant: Avatar }) {
  const f = LOOKS[variant].fur ?? GREY;
  const shirt: Partial<Record<Avatar, string>> = {
    ninja: '#1d3557', wizard: '#5f3dc4', astronaut: '#f1f3f5', superhero: '#1c7ed6', cap: '#f03e3e', crown: '#c92a2a',
  };
  const body = shirt[variant] ?? f.fur;
  return (
    <g stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
      <path d="M6 152 q2 -54 54 -54 q52 0 54 54z" fill={body} />
      {!shirt[variant] && variant !== 'pirate' && <ellipse cx="60" cy="122" rx="18" ry="16" fill={f.muzzle} stroke="none" />}
      {variant === 'pirate' && (
        <g>
          <path d="M6 152 q2 -54 54 -54 q52 0 54 54z" fill="#fff" />
          <path d="M20 112 h80 M11 126 h98 M7.5 140 h105" stroke="#e03131" strokeWidth="5" />
        </g>
      )}
      {variant === 'ninja' && <path d="M44 99 l16 22 l16 -22" fill="none" stroke="#adb5bd" strokeWidth="3" />}
      {variant === 'wizard' && <path d={star(60, 122, 8)} fill="#ffd43b" strokeWidth="1.5" />}
      {variant === 'astronaut' && (
        <g>
          <path d="M28 104 q32 12 64 0" fill="none" stroke="#adb5bd" strokeWidth="6" />
          <rect x="48" y="116" width="24" height="14" rx="3" fill="#4dabf7" strokeWidth="2" />
          <circle cx="54" cy="123" r="2" fill="#ff6b6b" stroke="none" /><circle cx="62" cy="123" r="2" fill="#ffd43b" stroke="none" />
        </g>
      )}
      {variant === 'superhero' && (
        <g>
          <path d="M30 102 l30 14 l30 -14 l-6 -6 l-24 10 l-24 -10z" fill="#e03131" />
          <circle cx="60" cy="128" r="11" fill="#ffd43b" strokeWidth="2" />
          <path d="M62 120 l-7 9 h5 l-3 8 l8 -10 h-5z" fill="#e03131" strokeWidth="1.2" />
        </g>
      )}
      {variant === 'cap' && <text x="60" y="134" textAnchor="middle" fontSize="22" fontWeight="900" fontFamily="system-ui, sans-serif" fill="#fff" stroke="none">1</text>}
      {variant === 'crown' && <path d="M24 108 q36 18 72 0 l4 10 q-40 18 -80 0z" fill="#fff" strokeWidth="2" />}
      {variant === 'golden' && (
        <g>
          <path d="M50 100 l10 18 l10 -18" fill="none" stroke="#1c7ed6" strokeWidth="4" />
          <circle cx="60" cy="124" r="8.5" fill="#ffd43b" strokeWidth="2" />
          <path d={star(60, 124.5, 5)} fill="#f59f00" stroke="none" />
        </g>
      )}
    </g>
  );
}

/** Little extras on the badge background: stars in space, confetti, music notes, sun rays. */
function Backdrop({ variant }: { variant: Avatar }) {
  switch (variant) {
    case 'wizard':
    case 'astronaut':
      return (
        <g fill="#fff">
          <path d={sparkle(18, 40, 4)} opacity="0.9" /><path d={sparkle(102, 30, 3)} opacity="0.8" />
          <circle cx="24" cy="80" r="1.3" /><circle cx="100" cy="70" r="1.5" /><circle cx="34" cy="20" r="1.2" /><circle cx="90" cy="14" r="1" />
          {variant === 'wizard' && <path d="M88 96 a12 12 0 1 0 12 -14 a9 9 0 1 1 -12 14z" fill="#ffd43b" opacity="0.9" />}
        </g>
      );
    case 'party':
      return (
        <g>
          <rect x="18" y="30" width="5" height="9" rx="1.5" fill="#4dabf7" transform="rotate(-25 20 34)" />
          <rect x="96" y="24" width="5" height="9" rx="1.5" fill="#ffd43b" transform="rotate(30 98 28)" />
          <rect x="102" y="70" width="5" height="9" rx="1.5" fill="#845ef7" transform="rotate(15 104 74)" />
          <circle cx="16" cy="70" r="3" fill="#ffd43b" /><circle cx="30" cy="16" r="2.5" fill="#845ef7" /><circle cx="86" cy="12" r="2.5" fill="#20c997" />
        </g>
      );
    case 'headphones':
      return (
        <g fill="#0ca678">
          <path d="M98 22 v14 a4 3 0 1 1 -2.2 -2.6 v-14 l9 -3 v4z" /><path d="M18 22 v12 a4 3 0 1 1 -2.2 -2.6 v-12z" />
        </g>
      );
    case 'golden':
      return (
        <g stroke="#fff" strokeWidth="7" opacity="0.35" strokeLinecap="round">
          {Array.from({ length: 12 }, (_, i) => <line key={i} x1="60" y1="16" x2="60" y2="2" transform={`rotate(${i * 30} 60 62)`} />)}
        </g>
      );
    case 'pirate':
      return <path d="M2 96 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 v30 h-120z" fill="#1c7ed6" opacity="0.45" />;
    default:
      return <g fill="#fff" opacity="0.35"><circle cx="22" cy="26" r="5" /><circle cx="100" cy="88" r="4" /><circle cx="14" cy="64" r="2.5" /></g>;
  }
}

export function RaccoonAvatar({ variant = 'classic', size = 48, title }: { variant?: string; size?: number; title?: string }) {
  const v: Avatar = isAvatar(variant) ? variant : 'classic';
  const uid = useSvgId();
  const [light, edge] = LOOKS[v].bg;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title ?? `${AVATAR_LABELS[v]} raccoon`} className="raccoon-avatar">
      <defs>
        <radialGradient id={`${uid}-bg`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={edge} />
        </radialGradient>
        <clipPath id={`${uid}-clip`}><circle cx="60" cy="60" r="57" /></clipPath>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <circle cx="60" cy="60" r="57" fill={`url(#${uid}-bg)`} />
        <Backdrop variant={v} />
        <g transform="translate(12 7) scale(0.8)">
          <Outfit variant={v} />
        </g>
      </g>
      <circle cx="60" cy="60" r="57" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="3" />
      <g transform="translate(12 7) scale(0.8)">
        <Head variant={v} />
      </g>
    </svg>
  );
}
/** The raccoon sweeping in the sunshine, for welcome screens. The sun's rays turn slowly in CSS. */
export function SunnyScene({ variant = 'ninja' }: { variant?: string }) {
  const v: Avatar = isAvatar(variant) ? variant : 'ninja';
  return (
    <svg viewBox="0 0 360 220" className="day-scene" role="img" aria-label="A raccoon sweeping on a sunny day">
      <rect width="360" height="220" fill="var(--scene-sky)" />
      {/* sun */}
      <g transform="translate(300 48)">
        <g className="sun-rays" stroke="#f2c14e" strokeWidth="5" strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1="0" y1="-30" x2="0" y2="-40" transform={`rotate(${i * 45})`} />
          ))}
        </g>
        <circle r="22" fill="#ffd43b" />
      </g>
      {/* clouds */}
      <g fill="#fff" opacity="0.9">
        <ellipse cx="70" cy="40" rx="30" ry="12" /><ellipse cx="92" cy="34" rx="20" ry="12" />
        <ellipse cx="190" cy="62" rx="24" ry="9" /><ellipse cx="206" cy="57" rx="15" ry="9" />
      </g>
      {/* grass */}
      <rect x="0" y="172" width="360" height="48" fill="var(--scene-grass)" />
      {/* dust being swept */}
      <g fill="var(--scene-dust)">
        <circle cx="236" cy="176" r="4" /><circle cx="250" cy="170" r="3" /><circle cx="262" cy="178" r="2.5" />
      </g>
      {/* raccoon body */}
      <ellipse cx="110" cy="172" rx="50" ry="46" fill={GREY.fur} stroke={INK} strokeWidth="2.5" />
      <ellipse cx="110" cy="184" rx="30" ry="26" fill={GREY.muzzle} />
      {/* broom */}
      <rect x="150" y="96" width="7" height="90" rx="3.5" fill="#8b5e3c" transform="rotate(-28 153 141)" />
      <path d="M190 172 l38 6 l-6 14 l-40 -4z" fill="#f2c14e" stroke="#c9a227" strokeWidth="2" />
      <path d="M146 150 q20 2 34 14" stroke={GREY.fur} strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* striped tail */}
      <g transform="translate(40 158) rotate(-35)">
        <ellipse cx="0" cy="0" rx="14" ry="40" fill={GREY.fur} stroke={INK} strokeWidth="2.5" />
        <rect x="-14" y="-28" width="28" height="9" fill={GREY.ear} />
        <rect x="-14" y="-8" width="28" height="9" fill={GREY.ear} />
        <rect x="-13" y="12" width="26" height="9" fill={GREY.ear} />
      </g>
      <g transform="translate(50 26)">
        <Head variant={v} />
      </g>
    </svg>
  );
}

/** Dr. Bandit: the raccoon doctor who answers questions in Doctors (head mirror and stethoscope). */
export function DoctorRaccoon({ size = 64, title = 'Raccoon doctor' }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 120 124" width={size} height={size} role="img" aria-label={title}>
      <Head variant="classic" />
      {/* head band with the round doctor's mirror */}
      <path d="M26 46 q34 -26 68 0" fill="none" stroke="#e9ecef" strokeWidth="6" strokeLinecap="round" />
      <circle cx="60" cy="30" r="11" fill="#dee2e6" stroke="#adb5bd" strokeWidth="2.5" />
      <circle cx="60" cy="30" r="5" fill="#f8f9fa" />
      {/* stethoscope around the neck */}
      <path d="M36 98 q24 22 48 0" fill="none" stroke="#1f6fb2" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M84 98 q8 10 2 18" fill="none" stroke="#1f6fb2" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="85" cy="118" r="5.5" fill="#adb5bd" stroke="#495057" strokeWidth="2" />
    </svg>
  );
}
