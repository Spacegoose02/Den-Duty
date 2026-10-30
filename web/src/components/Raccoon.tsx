// Den Duty's avatars: soft 3D animal friends (the raccoon is the mascot) in outfits, drawn in plain SVG so they
// theme and scale cleanly. Shapes are flat colors with a shared sheen laid over them for the rounded, toy-like look.
import { createContext, useContext, useId, type ReactNode } from 'react';
import { ANIMAL_LABELS, ANIMALS, avatarId, avatarLabel, OUTFIT_LABELS, OUTFITS, parseAvatar, type Animal, type Outfit } from '../../../shared/catalog.ts';

/** SVG ids must be unique per drawing on the page; useId's punctuation isn't safe inside url(#...). */
const useSvgId = () => `rc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
const Uid = createContext('rc');
const url = (uid: string, name: string) => `url(#${uid}-${name})`;

const LINE = '#4a2c2a';
const MOUTH = '#9c3048';
const TONGUE = '#ff8fa3';
const BLUSH = '#ff8fab';

/** Fur colors: light (lit side), base, shade (edges). */
type Coat = [string, string, string];
type Ears = 'round' | 'pointy' | 'cat' | 'long' | 'floppy' | 'fluffy';
interface Species {
  coat: Coat; muzzle: Coat; ear: string; earInner: string; ears: Ears;
  /** Dark patches around the eyes (raccoon mask, panda patches) get a white rim on the eyes so they read. */
  patches: boolean; nose: string; bg: [string, string]; body?: string;
}

const SPECIES: Record<Animal, Species> = {
  raccoon: { coat: ['#dfe4ea', '#aab3bd', '#7d8792'], muzzle: ['#ffffff', '#f3f1ec', '#d9d5cd'], ear: '#7a838e', earInner: '#f6c9d3', ears: 'round', patches: true, nose: '#2b2f38', bg: ['#d3f9d8', '#69db7c'] },
  fox: { coat: ['#ffc078', '#f57c2b', '#c95a12'], muzzle: ['#ffffff', '#fff5ea', '#f0dcc8'], ear: '#e8681c', earInner: '#fff1e6', ears: 'pointy', patches: false, nose: '#2b2026', bg: ['#fff4e6', '#ffa94d'] },
  panda: { coat: ['#ffffff', '#f1f3f5', '#ced4da'], muzzle: ['#ffffff', '#f8f9fa', '#e3e6ea'], ear: '#26282e', earInner: '#3a3d45', ears: 'round', patches: true, nose: '#1f2128', bg: ['#e6fcf5', '#63e6be'], body: '#2b2e35' },
  bunny: { coat: ['#fffaf3', '#f3e7d8', '#d9c6b0'], muzzle: ['#ffffff', '#fffdf9', '#efe6da'], ear: '#efe1cf', earInner: '#ffb3c6', ears: 'long', patches: false, nose: '#ff7a9c', bg: ['#fff0f6', '#f783ac'] },
  cat: { coat: ['#cfd6de', '#9aa5b1', '#6f7b88'], muzzle: ['#ffffff', '#f6f6f4', '#dcdad6'], ear: '#8a96a3', earInner: '#ffc2d1', ears: 'cat', patches: false, nose: '#ff8fa3', bg: ['#e7f5ff', '#74c0fc'] },
  bear: { coat: ['#c8946a', '#9a6440', '#6f4428'], muzzle: ['#f5dfc6', '#e6c39e', '#c9a079'], ear: '#8a5735', earInner: '#e6c39e', ears: 'round', patches: false, nose: '#2a1b14', bg: ['#fff9db', '#ffd43b'] },
  puppy: { coat: ['#fff3df', '#f2d9b3', '#d1b086'], muzzle: ['#ffffff', '#fffaf2', '#ecdcc4'], ear: '#a8693c', earInner: '#a8693c', ears: 'floppy', patches: false, nose: '#2a1d1a', bg: ['#e3fafc', '#66d9e8'] },
  koala: { coat: ['#d7dde3', '#a7b2bd', '#7c8894'], muzzle: ['#f8f9fa', '#e9ecef', '#cfd5db'], ear: '#a7b2bd', earInner: '#f1f3f5', ears: 'fluffy', patches: false, nose: '#3b3f4a', bg: ['#f3f0ff', '#b197fc'] },
  tiger: { coat: ['#ffcf7a', '#fb9a2c', '#d5700f'], muzzle: ['#ffffff', '#fff8ee', '#f1dfc9'], ear: '#f08a1c', earInner: '#fff1e0', ears: 'round', patches: false, nose: '#e8798c', bg: ['#ebfbee', '#8ce99a'] },
};

const GOLD_COAT: Coat = ['#fff1a8', '#f7c948', '#d39a12'];
/** The Golden Legend outfit turns any animal gold. */
const speciesFor = (animal: Animal, outfit: Outfit): Species =>
  outfit === 'golden' ? { ...SPECIES[animal], coat: GOLD_COAT, ear: '#e9b330', body: GOLD_COAT[1] } : SPECIES[animal];

type Eyes = 'open' | 'happy' | 'wink' | 'determined' | 'star' | 'wide';
type Mouth = 'smile' | 'grin' | 'smirk' | 'o';

/** Each outfit's expression, and the badge colors for outfits that set a scene (others use the animal's colors). */
const LOOKS: Record<Outfit, { eyes: Eyes; mouth: Mouth; bg?: [string, string] }> = {
  classic: { eyes: 'open', mouth: 'smile' },
  ninja: { eyes: 'determined', mouth: 'smirk', bg: ['#ffe8cc', '#ff922b'] },
  bandana: { eyes: 'wink', mouth: 'grin', bg: ['#fff3bf', '#fcc419'] },
  glasses: { eyes: 'open', mouth: 'smile', bg: ['#e3fafc', '#3bc9db'] },
  cap: { eyes: 'open', mouth: 'grin', bg: ['#f4fce3', '#94d82d'] },
  crown: { eyes: 'happy', mouth: 'smile', bg: ['#f3f0ff', '#9775fa'] },
  bow: { eyes: 'happy', mouth: 'grin', bg: ['#fff0f6', '#faa2c1'] },
  headphones: { eyes: 'happy', mouth: 'smile', bg: ['#e6fcf5', '#20c997'] },
  party: { eyes: 'open', mouth: 'grin', bg: ['#fff5f5', '#ff8787'] },
  pirate: { eyes: 'open', mouth: 'grin', bg: ['#d0ebff', '#339af0'] },
  wizard: { eyes: 'wide', mouth: 'o', bg: ['#7950f2', '#2f1a7a'] },
  astronaut: { eyes: 'wide', mouth: 'o', bg: ['#34457a', '#0f1630'] },
  superhero: { eyes: 'determined', mouth: 'grin', bg: ['#dbe4ff', '#4c6ef5'] },
  golden: { eyes: 'star', mouth: 'grin', bg: ['#fff9db', '#f59f00'] },
};

const star = (cx: number, cy: number, r: number) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    const d = i % 2 ? r * 0.45 : r;
    return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
  });
  return `M${pts.join('L')}Z`;
};
const sparkle = (x: number, y: number, s: number) =>
  `M${x} ${y - s} Q${x + s * 0.2} ${y - s * 0.2} ${x + s} ${y} Q${x + s * 0.2} ${y + s * 0.2} ${x} ${y + s} Q${x - s * 0.2} ${y + s * 0.2} ${x - s} ${y} Q${x - s * 0.2} ${y - s * 0.2} ${x} ${y - s}Z`;

/** Draws the left-hand shape and its mirror image on the right. */
const Pair = ({ children }: { children: ReactNode }) => (
  <>{children}<g transform="translate(120 0) scale(-1 1)">{children}</g></>
);

type ShapeProps = { d?: string; cx?: number; cy?: number; r?: number; rx?: number; ry?: number; x?: number; y?: number; width?: number; height?: number; transform?: string; opacity?: number };
/** A shape in a flat color with the soft highlight-and-shade sheen on top, which is what makes things look 3D. */
function Vol({ shape = 'path', fill, ...p }: ShapeProps & { shape?: 'path' | 'circle' | 'ellipse' | 'rect'; fill: string }) {
  const uid = useContext(Uid);
  const El = shape;
  return (
    <>
      <El fill={fill} {...p} />
      <El fill={url(uid, 'sheen')} {...p} />
    </>
  );
}

/** Gradients and filters every drawing uses. */
function Defs({ uid, coat, muzzle }: { uid: string; coat: Coat; muzzle: Coat }) {
  return (
    <defs>
      <radialGradient id={`${uid}-sheen`} cx="0.36" cy="0.26" r="0.85">
        <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
        <stop offset="0.75" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.26" />
      </radialGradient>
      <radialGradient id={`${uid}-fur`} cx="0.4" cy="0.28" r="0.8">
        <stop offset="0" stopColor={coat[0]} />
        <stop offset="0.55" stopColor={coat[1]} />
        <stop offset="1" stopColor={coat[2]} />
      </radialGradient>
      <radialGradient id={`${uid}-muzzle`} cx="0.45" cy="0.3" r="0.8">
        <stop offset="0" stopColor={muzzle[0]} />
        <stop offset="0.6" stopColor={muzzle[1]} />
        <stop offset="1" stopColor={muzzle[2]} />
      </radialGradient>
      <radialGradient id={`${uid}-eye`} cx="0.5" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#5a3a2c" />
        <stop offset="0.55" stopColor="#24161a" />
        <stop offset="1" stopColor="#0b0710" />
      </radialGradient>
      <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff3a3" />
        <stop offset="0.5" stopColor="#fcc419" />
        <stop offset="1" stopColor="#e67700" />
      </linearGradient>
      <filter id={`${uid}-soft`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.7" /></filter>
      <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      <filter id={`${uid}-drop`} x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.8" floodColor="#1b1530" floodOpacity="0.25" />
      </filter>
    </defs>
  );
}

function EarsBack({ s }: { s: Species }) {
  switch (s.ears) {
    case 'round':
      return (
        <Pair>
          <Vol shape="circle" cx={29} cy={38} r={14} fill={s.ear} />
          <circle cx="30" cy="40" r="7.5" fill={s.earInner} opacity="0.9" />
        </Pair>
      );
    case 'pointy':
      return (
        <Pair>
          <Vol d="M18 54 L22 16 Q24 9 30 13 L50 38 Z" fill={s.ear} />
          <path d="M25 46 L27 23 L42 40 Z" fill={s.earInner} />
          <path d="M22 16 Q24 9 30 13 L35 19 Q28 18 21.5 26 Z" fill="#3a2522" />
        </Pair>
      );
    case 'cat':
      return (
        <Pair>
          <Vol d="M19 52 L22 20 Q23 14 29 17 L47 36 Z" fill={s.ear} />
          <path d="M25 45 L26.5 26 L39 38 Z" fill={s.earInner} />
        </Pair>
      );
    case 'long':
      return (
        <Pair>
          <Vol shape="ellipse" cx={40} cy={15} rx={10} ry={23} transform="rotate(-10 40 15)" fill={s.ear} />
          <ellipse cx="40" cy="17" rx="5" ry="16" transform="rotate(-10 40 17)" fill={s.earInner} />
        </Pair>
      );
    case 'fluffy':
      return (
        <Pair>
          <Vol shape="circle" cx={23} cy={44} r={19} fill={s.ear} />
          <circle cx="25" cy="46" r="11" fill={s.earInner} />
          <path d="M14 40 q3 -3 6 0 q3 -3 6 0 M15 50 q3 -3 6 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.8" />
        </Pair>
      );
    default:
      return null;
  }
}

/** Fur markings drawn on the head, under the muzzle. */
function Markings({ animal, uid, mask }: { animal: Animal; uid: string; mask: string }) {
  switch (animal) {
    case 'raccoon':
      return (
        <g filter={url(uid, 'soft')}>
          <path d="M60 32 q-6 9 0 20 q6 -11 0 -20z" fill="#6d7681" />
          <path d="M33 47 q8 -6 16 -2 M87 47 q-8 -6 -16 -2" stroke="#fff" strokeWidth="4.2" fill="none" strokeLinecap="round" />
          <path d="M18 62 C20 48 34 44 44 48 C50 50 55 53 60 56 C65 53 70 50 76 48 C86 44 100 48 102 62 C102 72 92 77 80 75 C72 74 66 70 60 67 C54 70 48 74 40 75 C28 77 18 72 18 62Z" fill={mask} />
        </g>
      );
    case 'panda':
      return (
        <g filter={url(uid, 'soft')}>
          <Pair><ellipse cx="41" cy="63" rx="11" ry="13.5" transform="rotate(28 41 63)" fill={mask} /></Pair>
        </g>
      );
    case 'cat':
      return (
        <g stroke="#6f7b88" strokeWidth="3" strokeLinecap="round" filter={url(uid, 'soft')}>
          <path d="M60 33 v9 M51 35 l2 7 M69 35 l-2 7" />
          <Pair><path d="M20 62 l8 1 M19 69 l8 0" /></Pair>
        </g>
      );
    case 'tiger':
      return (
        <g fill="#3a2414" filter={url(uid, 'soft')}>
          <path d="M60 32 q-3 6 0 11 q3 -5 0 -11z M50 34 q-1 6 3 9 q0 -6 -3 -9z M70 34 q1 6 -3 9 q0 -6 3 -9z" />
          <Pair><path d="M20 58 q8 0 12 3 q-7 1 -12 1z M19 68 q8 -1 12 1 q-6 2 -12 2z M24 48 q6 1 9 5 q-6 -1 -10 -2z" /></Pair>
          <Pair><ellipse cx="44" cy="49" rx="5" ry="3" fill="#fff8ee" /></Pair>
        </g>
      );
    case 'puppy':
      return <ellipse cx="78" cy="61" rx="13" ry="12" fill="#c58a5a" filter={url(uid, 'soft')} />;
    case 'fox':
      return <Pair><path d="M16 70 C26 66 40 66 52 76 L60 80 L60 101 C36 101 18 92 16 76Z" fill="#fff" opacity="0.95" filter={url(uid, 'soft')} /></Pair>;
    default:
      return null;
  }
}

function Eye({ x, y, kind, rim, uid }: { x: number; y: number; kind: Eyes | 'closed'; rim: boolean; uid: string }) {
  if (kind === 'happy' || kind === 'closed') {
    return <path d={`M${x - 6.5} ${y + 2} q6.5 -9 13 0`} stroke={rim ? '#fff' : LINE} strokeWidth="3.4" fill="none" strokeLinecap="round" />;
  }
  if (kind === 'star') {
    return (
      <g>
        {rim && <circle cx={x} cy={y} r="9.5" fill="#fff" />}
        <path d={star(x, y + 0.5, 9)} fill={url(uid, 'gold')} />
        <circle cx={x - 2.4} cy={y - 2.2} r="1.8" fill="#fff" />
      </g>
    );
  }
  const big = kind === 'wide' ? 1.15 : 1;
  return (
    <g>
      {rim && <circle cx={x} cy={y} r={9.6 * big} fill="#fff" />}
      <ellipse cx={x} cy={y} rx={7 * big} ry={7.8 * big} fill={url(uid, 'eye')} />
      <ellipse cx={x - 2.4 * big} cy={y - 3 * big} rx={2.9 * big} ry={2.4 * big} fill="#fff" />
      <circle cx={x + 2.8 * big} cy={y + 2.9 * big} r={1.3 * big} fill="#fff" opacity="0.9" />
    </g>
  );
}

function MouthShape({ kind }: { kind: Mouth }) {
  if (kind === 'grin') {
    return (
      <g>
        <path d="M51 86 h18 q-1.5 11.5 -9 11.5 q-7.5 0 -9 -11.5z" fill={MOUTH} />
        <path d="M54.5 93 q5.5 -4 11 0 q-1.6 4 -5.5 4 q-3.9 0 -5.5 -4z" fill={TONGUE} />
        <rect x="56.4" y="86" width="7.2" height="3.6" rx="1.2" fill="#fff" />
      </g>
    );
  }
  if (kind === 'smirk') return <path d="M52 89 q9 5 16 -3" stroke={LINE} strokeWidth="2.6" fill="none" strokeLinecap="round" />;
  if (kind === 'o') return <ellipse cx="60" cy="91" rx="4" ry="5" fill={MOUTH} />;
  return <path d="M60 83 v3 M52.5 86.5 q3.75 4.5 7.5 0 q3.75 4.5 7.5 0" stroke={LINE} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

const HEAD = 'M60 31 C86 31 102 46 103 64 C104 71 107 76 104 82 C99 93 84 101 60 101 C36 101 21 93 16 82 C13 76 16 71 17 64 C18 46 34 31 60 31Z';

/** The animal's head on the 120 grid, centred at (60, 66), with its outfit's hat or glasses. */
function Head({ animal = 'raccoon', outfit = 'classic', uid: given }: { animal?: Animal; outfit?: Outfit; uid?: string }) {
  const own = useSvgId();
  const uid = given ?? own;
  const s = speciesFor(animal, outfit);
  const look = LOOKS[outfit];
  const mask = outfit === 'superhero' && animal === 'raccoon' ? '#e03131' : animal === 'panda' ? '#26282e' : outfit === 'golden' ? '#7a4a0c' : '#3a404a';
  const hero = outfit === 'superhero' && animal !== 'raccoon';
  const rim = s.patches || hero || look.eyes === 'star';
  return (
    <Uid.Provider value={uid}>
      <g>
        {!given && <Defs uid={uid} coat={s.coat} muzzle={s.muzzle} />}
        <g filter={url(uid, 'drop')}>
          <EarsBack s={s} />
          <path d={HEAD} fill={url(uid, 'fur')} />
        </g>
        <Markings animal={animal} uid={uid} mask={mask} />
        {/* muzzle */}
        <path d="M34 83 C34 73 46 69 60 71 C74 69 86 73 86 83 C86 95 74 100.5 60 100.5 C46 100.5 34 95 34 83Z" fill={url(uid, 'muzzle')} />
        {animal === 'koala' && <Pair><path d="M18 64 q-4 6 0 12 M22 74 q-4 4 -1 9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" /></Pair>}
        {hero && (
          <g filter={url(uid, 'drop')}>
            <Vol d="M20 61 C22 50 34 47 44 50 C50 52 55 54 60 56 C65 54 70 52 76 50 C86 47 98 50 100 61 C100 70 92 74 80 73 C72 72 66 69 60 66 C54 69 48 72 40 73 C28 74 20 70 20 61Z" fill="#e03131" />
          </g>
        )}
        {look.eyes === 'determined' && (
          <path d="M33 45 l15 5.5 M87 45 l-15 5.5" stroke={rim ? '#fff' : LINE} strokeWidth="3.6" strokeLinecap="round" />
        )}
        <Eye x={42} y={62} kind={look.eyes} rim={rim} uid={uid} />
        <Eye x={78} y={62} kind={look.eyes === 'wink' ? 'closed' : look.eyes} rim={rim} uid={uid} />
        {/* blush */}
        <g filter={url(uid, 'blur')} opacity="0.75">
          <ellipse cx="34" cy="80" rx="7" ry="4.5" fill={BLUSH} />
          <ellipse cx="86" cy="80" rx="7" ry="4.5" fill={BLUSH} />
        </g>
        {/* nose */}
        {animal === 'koala'
          ? <Vol shape="ellipse" cx={60} cy={79} rx={9} ry={8} fill={s.nose} />
          : <Vol d="M52 76 q8 -5 16 0 q-1.6 7 -8 8 q-6.4 -1 -8 -8z" fill={s.nose} />}
        <ellipse cx={animal === 'koala' ? 57 : 57.5} cy={animal === 'koala' ? 75.5 : 76.4} rx="2.8" ry="1.4" fill="#fff" opacity="0.75" />
        <MouthShape kind={look.mouth} />
        {(animal === 'cat' || animal === 'tiger') && (
          <g stroke={LINE} strokeWidth="1.3" strokeLinecap="round" opacity="0.55">
            <Pair><path d="M36 84 l-14 -2 M36 88 l-13 3" /></Pair>
          </g>
        )}
        {s.ears === 'floppy' && (
          <Pair><Vol d="M28 38 C12 36 6 56 9 76 C10 86 20 88 25 79 C30 68 34 50 28 38Z" fill={s.ear} /></Pair>
        )}
        <Gear outfit={outfit} animal={animal} />
      </g>
    </Uid.Provider>
  );
}

/** Hats, glasses and the like, drawn over the head. */
function Gear({ outfit, animal }: { outfit: Outfit; animal: Animal }) {
  const uid = useContext(Uid);
  const drop = url(uid, 'drop');
  switch (outfit) {
    case 'ninja':
      return (
        <g filter={drop}>
          <Vol d="M100 51 q12 -10 19 -5 q-8 3 -15 10z" fill="#274b77" />
          <Vol d="M100 54 q13 1 16 10 q-9 -4 -16 -5z" fill="#274b77" />
          <Vol d="M19 50 q41 -27 82 0 l-1.5 10 q-39.5 -25 -79 0z" fill="#1d3557" />
          <Vol shape="circle" cx={100} cy={53} r={4.2} fill="#1d3557" />
          <Vol shape="rect" x={50} y={35} width={20} height={11} fill="#ced4da" />
          <path d={star(60, 40.6, 3.8)} fill="#495057" />
        </g>
      );
    case 'bandana':
      return (
        <g filter={drop}>
          <Vol d="M32 95 q28 12 56 0 l-28 23z" fill="#e03131" />
          <g fill="#fff"><circle cx="47" cy="102" r="2" /><circle cx="60" cy="104.5" r="2" /><circle cx="73" cy="102" r="2" /><circle cx="60" cy="111" r="2" /></g>
        </g>
      );
    case 'glasses':
      return (
        <g>
          <g fill="rgba(255,255,255,.2)" stroke="#5c3d1e" strokeWidth="3.4">
            <circle cx="42" cy="62" r="12" />
            <circle cx="78" cy="62" r="12" />
          </g>
          <path d="M54 61 q6 -4 12 0 M30 59 l-10 -4 M90 59 l10 -4" stroke="#5c3d1e" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <path d="M33 55 q5 -4 9 -3 M69 55 q5 -4 9 -3" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.8" />
          <g filter={drop}>
            <Vol d="M60 104 l-12 -7 v14z" fill="#e03131" />
            <Vol d="M60 104 l12 -7 v14z" fill="#e03131" />
            <Vol shape="circle" cx={60} cy={104} r={3.6} fill="#c92a2a" />
          </g>
        </g>
      );
    case 'cap':
      return (
        <g filter={drop}>
          <Vol d="M80 41 q23 -6 34 3 q-5 7.5 -34 3z" fill="#c92a2a" />
          <Vol d="M29 45 q1 -33 31 -33 q30 0 31 33 q-31 -9 -62 0z" fill="#f03e3e" />
          <path d={star(45, 30, 5.6)} fill="#fff" />
          <Vol shape="circle" cx={60} cy={12.5} r={3.6} fill="#c92a2a" />
        </g>
      );
    case 'crown':
      return <Crown />;
    case 'golden':
      return (
        <g>
          <Crown />
          <g fill="#fff">
            <path d={sparkle(13, 26, 7)} /><path d={sparkle(108, 20, 6)} /><path d={sparkle(107, 92, 4.5)} />
          </g>
        </g>
      );
    case 'bow':
      return (
        <g filter={drop} transform={animal === 'bunny' ? 'translate(-16 18)' : 'rotate(-12 76 28)'}>
          <Vol d="M76 28 q-21 -19 -23 -2 q0 15 23 2z" fill="#f06595" />
          <Vol d="M76 28 q21 -19 23 -2 q0 15 -23 2z" fill="#f06595" />
          <g fill="#fff" opacity="0.9"><circle cx="61" cy="24" r="1.9" /><circle cx="64" cy="32" r="1.6" /><circle cx="91" cy="24" r="1.9" /><circle cx="88" cy="32" r="1.6" /></g>
          <Vol shape="circle" cx={76} cy={28} r={5.2} fill="#d6336c" />
        </g>
      );
    case 'headphones':
      return (
        <g filter={drop}>
          <path d="M19 66 q0 -57 41 -57 q41 0 41 57" fill="none" stroke="#3b3f48" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M24 40 q10 -26 36 -27" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
          <Vol shape="rect" x={8} y={52} width={18} height={28} fill="#f06595" />
          <Vol shape="rect" x={94} y={52} width={18} height={28} fill="#f06595" />
          <rect x="20" y="56" width="5" height="20" rx="2" fill="#c2255c" />
          <rect x="95" y="56" width="5" height="20" rx="2" fill="#c2255c" />
        </g>
      );
    case 'party':
      return (
        <g filter={drop} transform="rotate(14 60 34)">
          <Vol d="M60 -2 l-17 37 q17 6 34 0z" fill="#4dabf7" />
          <g fill="#ffd43b"><circle cx="55" cy="25" r="2.6" /><circle cx="63" cy="14" r="2.4" /><circle cx="66" cy="28" r="2.6" /><circle cx="58" cy="7" r="1.6" /></g>
          <Vol shape="circle" cx={60} cy={-3} r={5.4} fill="#ffd43b" />
        </g>
      );
    case 'pirate':
      return (
        <g>
          <path d="M22 48 Q50 50 78 62 L100 71" stroke="#25282d" strokeWidth="2.6" fill="none" />
          <Vol shape="ellipse" cx={78} cy={62.5} rx={11} ry={10} fill="#25282d" />
          <g filter={drop}>
            <Vol d="M15 48 q8 -12 20 -9 q7 -26 25 -26 q18 0 25 26 q12 -3 20 9 q-45 -11 -90 0z" fill="#2b2f36" />
            <path d="M20 46 q40 -9 80 0" stroke="#fcc419" strokeWidth="2.6" fill="none" />
            <path d="M53 37 l14 -4 M53 33 l14 4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="60" cy="27" r="5.6" fill="#fff" />
            <circle cx="58" cy="27" r="1.3" fill="#2b2f36" /><circle cx="62" cy="27" r="1.3" fill="#2b2f36" />
          </g>
        </g>
      );
    case 'wizard':
      return (
        <g filter={drop}>
          <Vol d="M35 43 L57 1 q7 -8 15 -2 q-7 0 -8 6 L85 43z" fill="#4263eb" />
          <Vol shape="ellipse" cx={60} cy={43} rx={34} ry={7} fill="#364fc7" />
          <path d={star(60, 26, 6.4)} fill={url(uid, 'gold')} />
          <path d={sparkle(70, 13, 3)} fill="#ffe066" />
          <path d={sparkle(49, 36, 2.4)} fill="#ffe066" />
        </g>
      );
    case 'astronaut':
      return (
        <g>
          <circle cx="60" cy="62" r="51" fill="rgba(208,235,255,.16)" stroke="#e9ecef" strokeWidth="5" />
          <circle cx="60" cy="62" r="51" fill="none" stroke={url(uid, 'sheen')} strokeWidth="5" />
          <path d="M24 36 q13 -18 34 -20" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.8" />
          <circle cx="94" cy="94" r="3" fill="#fff" opacity="0.7" />
        </g>
      );
    case 'superhero':
      return (
        <g filter={drop}>
          <Vol d="M100 58 q10 -4 16 2 q-8 0 -14 6z" fill="#e03131" />
          <Vol d="M100 62 q8 6 12 14 q-7 -6 -13 -8z" fill="#e03131" />
        </g>
      );
    default:
      return null;
  }
}

function Crown() {
  const uid = useContext(Uid);
  return (
    <g filter={url(uid, 'drop')}>
      <path d="M35 42 l2 -26 l12.5 12.5 l10.5 -18 l10.5 18 l12.5 -12.5 l2 26 q-25 -6 -50 0z" fill={url(uid, 'gold')} />
      <path d="M38 38 q22 -5 44 0" stroke="#fff" strokeWidth="1.6" fill="none" opacity="0.6" />
      <Vol shape="circle" cx={37} cy={15} r={3} fill="#fff3bf" />
      <Vol shape="circle" cx={60} cy={10} r={3} fill="#fff3bf" />
      <Vol shape="circle" cx={83} cy={15} r={3} fill="#fff3bf" />
      <Vol shape="circle" cx={60} cy={31} r={4.2} fill="#e03131" />
      <Vol shape="circle" cx={46} cy={34} r={3} fill="#1c7ed6" />
      <Vol shape="circle" cx={74} cy={34} r={3} fill="#2f9e44" />
    </g>
  );
}

/** Shoulders and outfit under the head, only on the avatar badge. Drawn on the head's grid. */
function Clothes({ animal, outfit }: { animal: Animal; outfit: Outfit }) {
  const uid = useContext(Uid);
  const s = speciesFor(animal, outfit);
  const shirt: Partial<Record<Outfit, string>> = {
    ninja: '#1d3557', wizard: '#5f3dc4', astronaut: '#f1f3f5', superhero: '#1c7ed6', cap: '#f03e3e', crown: '#c92a2a', pirate: '#fff',
  };
  const body = shirt[outfit] ?? s.body ?? s.coat[1];
  return (
    <g>
      <Vol d="M6 152 q2 -54 54 -54 q52 0 54 54z" fill={body} />
      {!shirt[outfit] && <ellipse cx="60" cy="124" rx="18" ry="17" fill={url(uid, 'muzzle')} />}
      {outfit === 'pirate' && <path d="M20 112 h80 M11 126 h98 M7.5 140 h105" stroke="#e03131" strokeWidth="5" />}
      {outfit === 'ninja' && <path d="M44 99 l16 22 l16 -22" fill="none" stroke="#adb5bd" strokeWidth="3" />}
      {outfit === 'wizard' && <path d={star(60, 122, 8)} fill={url(uid, 'gold')} />}
      {outfit === 'astronaut' && (
        <g>
          <path d="M28 104 q32 12 64 0" fill="none" stroke="#adb5bd" strokeWidth="6" />
          <Vol shape="rect" x={48} y={116} width={24} height={14} fill="#4dabf7" />
          <circle cx="54" cy="123" r="2" fill="#ff6b6b" /><circle cx="62" cy="123" r="2" fill="#ffd43b" />
        </g>
      )}
      {outfit === 'superhero' && (
        <g>
          <Vol d="M30 102 l30 14 l30 -14 l-6 -6 l-24 10 l-24 -10z" fill="#e03131" />
          <Vol shape="circle" cx={60} cy={128} r={11} fill="#ffd43b" />
          <path d="M62 120 l-7 9 h5 l-3 8 l8 -10 h-5z" fill="#e03131" />
        </g>
      )}
      {outfit === 'cap' && <text x="60" y="134" textAnchor="middle" fontSize="22" fontWeight="900" fontFamily="system-ui, sans-serif" fill="#fff">1</text>}
      {outfit === 'crown' && <Vol d="M24 108 q36 18 72 0 l4 10 q-40 18 -80 0z" fill="#fff" />}
      {outfit === 'golden' && (
        <g>
          <path d="M50 100 l10 18 l10 -18" fill="none" stroke="#1c7ed6" strokeWidth="4" />
          <Vol shape="circle" cx={60} cy={124} r={8.5} fill="#ffd43b" />
          <path d={star(60, 124.5, 5)} fill="#f59f00" />
        </g>
      )}
    </g>
  );
}

/** Little extras on the badge background: stars in space, confetti, music notes, sun rays. */
function Backdrop({ outfit }: { outfit: Outfit }) {
  switch (outfit) {
    case 'wizard':
    case 'astronaut':
      return (
        <g fill="#fff">
          <path d={sparkle(18, 40, 4)} opacity="0.9" /><path d={sparkle(102, 30, 3)} opacity="0.8" />
          <circle cx="24" cy="80" r="1.3" /><circle cx="100" cy="70" r="1.5" /><circle cx="34" cy="20" r="1.2" /><circle cx="90" cy="14" r="1" />
          {outfit === 'wizard' && <path d="M88 96 a12 12 0 1 0 12 -14 a9 9 0 1 1 -12 14z" fill="#ffd43b" opacity="0.9" />}
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
        <g fill="#fff" opacity="0.85">
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
      return null;
  }
}

/** A kid's (or parent's) avatar: an animal friend in an outfit on a round badge. */
export function RaccoonAvatar({ variant = 'classic', size = 48, title }: { variant?: string; size?: number; title?: string }) {
  const { animal, outfit } = parseAvatar(variant) ?? { animal: 'raccoon' as const, outfit: 'classic' as const };
  const uid = useSvgId();
  const s = speciesFor(animal, outfit);
  const [light, edge] = LOOKS[outfit].bg ?? s.bg;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title ?? avatarLabel(variant)} className="raccoon-avatar">
      <Defs uid={uid} coat={s.coat} muzzle={s.muzzle} />
      <defs>
        <radialGradient id={`${uid}-bg`} cx="0.35" cy="0.25" r="0.85">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={edge} />
        </radialGradient>
        <radialGradient id={`${uid}-vignette`} cx="0.5" cy="0.45" r="0.55">
          <stop offset="0.75" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.16" />
        </radialGradient>
        <clipPath id={`${uid}-clip`}><circle cx="60" cy="60" r="58" /></clipPath>
      </defs>
      <Uid.Provider value={uid}>
        <g clipPath={url(uid, 'clip')}>
          <circle cx="60" cy="60" r="58" fill={url(uid, 'bg')} />
          <circle cx="60" cy="60" r="58" fill={url(uid, 'vignette')} />
          <Backdrop outfit={outfit} />
          <g transform="translate(12 8) scale(0.8)">
            <Clothes animal={animal} outfit={outfit} />
            <ellipse cx="60" cy="102" rx="30" ry="6" fill="#000" opacity="0.18" filter={url(uid, 'blur')} />
          </g>
        </g>
        <g transform="translate(12 8) scale(0.8)">
          <Head animal={animal} outfit={outfit} uid={uid} />
        </g>
      </Uid.Provider>
    </svg>
  );
}

/** The raccoon sweeping in the sunshine, for welcome screens. The sun's rays turn slowly in CSS. */
export function SunnyScene({ variant = 'ninja' }: { variant?: string }) {
  const { animal, outfit } = parseAvatar(variant) ?? { animal: 'raccoon' as const, outfit: 'ninja' as const };
  const s = SPECIES[animal];
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
      <ellipse cx="110" cy="172" rx="50" ry="46" fill={s.coat[1]} />
      <ellipse cx="110" cy="184" rx="30" ry="26" fill={s.muzzle[1]} />
      {/* broom */}
      <rect x="150" y="96" width="7" height="90" rx="3.5" fill="#8b5e3c" transform="rotate(-28 153 141)" />
      <path d="M190 172 l38 6 l-6 14 l-40 -4z" fill="#f2c14e" stroke="#c9a227" strokeWidth="2" />
      <path d="M146 150 q20 2 34 14" stroke={s.coat[1]} strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* striped tail */}
      <g transform="translate(40 158) rotate(-35)">
        <ellipse cx="0" cy="0" rx="14" ry="40" fill={s.coat[1]} />
        <rect x="-14" y="-28" width="28" height="9" fill={animal === 'raccoon' ? s.ear : s.coat[1]} />
        <rect x="-14" y="-8" width="28" height="9" fill={animal === 'raccoon' ? s.ear : s.coat[1]} />
        <rect x="-13" y="12" width="26" height="9" fill={animal === 'raccoon' ? s.ear : s.coat[1]} />
      </g>
      <g transform="translate(50 26)">
        <Head animal={animal} outfit={outfit} />
      </g>
    </svg>
  );
}

/** Dr. Bandit: the raccoon doctor who answers questions in Doctors (head mirror and stethoscope). */
export function DoctorRaccoon({ size = 64, title = 'Raccoon doctor' }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 120 124" width={size} height={size} role="img" aria-label={title}>
      <Head />
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

/**
 * Pick an animal, then an outfit. `lockedAt` returns the level an outfit needs, or null when it's open to this person.
 */
export function AvatarPicker({ value, onPick, lockedAt }: { value: string; onPick: (avatar: string) => void; lockedAt?: (outfit: Outfit) => number | null }) {
  const current = parseAvatar(value) ?? { animal: 'raccoon' as const, outfit: 'classic' as const };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips">
        {ANIMALS.map((a) => {
          const id = avatarId(a, current.outfit);
          return (
            <button key={a} type="button" className={`chip avatar-chip${current.animal === a ? ' on' : ''}`} onClick={() => onPick(id)}>
              <RaccoonAvatar variant={id} size={52} />
              <span className="small">{ANIMAL_LABELS[a]}</span>
            </button>
          );
        })}
      </div>
      <div className="chips">
        {OUTFITS.map((o) => {
          const id = avatarId(current.animal, o);
          const level = lockedAt?.(o) ?? null;
          return (
            <button key={o} type="button" className={`chip avatar-chip${current.outfit === o ? ' on' : ''}`} disabled={level !== null} onClick={() => onPick(id)}>
              <span style={{ filter: level === null ? undefined : 'grayscale(1) opacity(.5)' }}><RaccoonAvatar variant={id} size={52} /></span>
              <span className="small">{level === null ? OUTFIT_LABELS[o] : `🔒 Level ${level}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
