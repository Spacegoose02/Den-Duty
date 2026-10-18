// The Den Duty mascot: a masked raccoon, drawn in plain SVG so it themes and scales cleanly.
import { AVATAR_LABELS, isAvatar, type Avatar } from '../../../shared/catalog.ts';

function Head({ variant }: { variant: Avatar }) {
  return (
    <g>
      {/* ears */}
      <circle cx="30" cy="40" r="13" fill="#868d94" />
      <circle cx="90" cy="40" r="13" fill="#868d94" />
      <circle cx="30" cy="40" r="6.5" fill="#3a3f44" />
      <circle cx="90" cy="40" r="6.5" fill="#3a3f44" />
      {/* head */}
      <ellipse cx="60" cy="66" rx="40" ry="33" fill="#a3aab1" />
      <path d="M60 34 q-6 10 0 22 q6 -12 0 -22z" fill="#6f767d" />
      {/* cheeks */}
      <ellipse cx="60" cy="78" rx="29" ry="19" fill="#f4f4f2" />
      {/* the bandit mask */}
      <path d="M22 60 q38 -24 76 0 q-6 15 -21 12 q-17 -5 -34 0 q-15 3 -21 -12z" fill="#262a2e" />
      {variant === 'ninja' && (
        <g>
          <rect x="18" y="40" width="84" height="9" rx="3" fill="#1d3557" />
          <path d="M100 44 l16 -6 l-3 8 l5 6 l-18 -3z" fill="#1d3557" />
        </g>
      )}
      {/* eyes */}
      <circle cx="44" cy="62" r="5.5" fill="#fff" />
      <circle cx="76" cy="62" r="5.5" fill="#fff" />
      <circle cx="45" cy="62.5" r="3" fill="#111" />
      <circle cx="77" cy="62.5" r="3" fill="#111" />
      <circle cx="46" cy="61" r="1" fill="#fff" />
      <circle cx="78" cy="61" r="1" fill="#fff" />
      {variant === 'glasses' && (
        <g fill="none" stroke="#c9a227" strokeWidth="2.5">
          <circle cx="44" cy="62" r="10" />
          <circle cx="76" cy="62" r="10" />
          <path d="M54 61 q6 -4 12 0" />
        </g>
      )}
      {/* nose and smile */}
      <ellipse cx="60" cy="79" rx="6" ry="4.2" fill="#222" />
      <path d="M51 87 q9 7 18 0" stroke="#222" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* hats and extras */}
      {variant === 'bandana' && <path d="M38 94 q22 18 44 0 l-22 18z" fill="#d62828" />}
      {variant === 'cap' && (
        <g>
          <path d="M28 40 q32 -34 64 0 z" fill="#1f6fb2" />
          <path d="M80 38 q22 -2 30 6 q-14 2 -30 0z" fill="#174f80" />
          <circle cx="60" cy="16" r="3" fill="#174f80" />
        </g>
      )}
      {variant === 'crown' && (
        <g>
          <path d="M34 38 l4 -24 l11 13 l11 -18 l11 18 l11 -13 l4 24 z" fill="#f2c14e" stroke="#c9a227" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="60" cy="30" r="3.5" fill="#d62828" />
          <circle cx="44" cy="32" r="2.5" fill="#1f6fb2" />
          <circle cx="76" cy="32" r="2.5" fill="#2f9e6e" />
        </g>
      )}
      {variant === 'bow' && (
        <g>
          <path d="M70 30 l-14 -12 v24z" fill="#e64980" />
          <path d="M70 30 l14 -12 v24z" fill="#e64980" />
          <circle cx="70" cy="30" r="5" fill="#c2255c" />
        </g>
      )}
      {variant === 'party' && (
        <g>
          <path d="M60 2 l-16 38 h32z" fill="#e64980" />
          <path d="M52 21 l16 0 M48 30 l24 0" stroke="#ffd43b" strokeWidth="4" />
          <circle cx="60" cy="3" r="5" fill="#ffd43b" />
        </g>
      )}
      {variant === 'pirate' && (
        <g>
          <path d="M22 40 q38 -40 76 0 q-38 -10 -76 0z" fill="#212529" />
          <circle cx="60" cy="26" r="5" fill="#fff" />
          <path d="M56 32 l8 0" stroke="#fff" strokeWidth="2" />
          <circle cx="76" cy="62" r="8" fill="#111" />
          <path d="M30 50 l52 18" stroke="#111" strokeWidth="2.5" />
        </g>
      )}
      {variant === 'wizard' && (
        <g>
          <path d="M60 -4 l-26 44 h52z" fill="#5f3dc4" />
          <rect x="26" y="36" width="68" height="7" rx="3.5" fill="#4c2fa0" />
          <path d="M52 18 l3 6 l6 1 l-5 4 l1 6 l-5 -3 l-5 3 l1 -6 l-5 -4 l6 -1z" fill="#ffd43b" />
        </g>
      )}
      {variant === 'astronaut' && (
        <g>
          <circle cx="60" cy="64" r="50" fill="rgba(165,216,255,.28)" stroke="#dee2e6" strokeWidth="5" />
          <path d="M28 34 q14 -14 30 -16" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.8" />
        </g>
      )}
      {variant === 'superhero' && (
        <g>
          <path d="M22 60 q38 -24 76 0 q-6 15 -21 12 q-17 -5 -34 0 q-15 3 -21 -12z" fill="#e03131" />
          <circle cx="44" cy="62" r="5.5" fill="#fff" />
          <circle cx="76" cy="62" r="5.5" fill="#fff" />
          <circle cx="45" cy="62.5" r="3" fill="#111" />
          <circle cx="77" cy="62.5" r="3" fill="#111" />
          <path d="M44 100 l16 10 l16 -10" fill="#ffd43b" stroke="#e03131" strokeWidth="3" />
        </g>
      )}
      {variant === 'golden' && (
        <g>
          <ellipse cx="60" cy="66" rx="44" ry="37" fill="none" stroke="#fcc419" strokeWidth="4" opacity="0.8" />
          <path d="M34 38 l4 -24 l11 13 l11 -18 l11 18 l11 -13 l4 24 z" fill="#fcc419" stroke="#e67700" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="60" cy="30" r="3.5" fill="#1098ad" />
          <path d="M14 30 l3 -6 l3 6 l-3 6z M102 24 l3 -6 l3 6 l-3 6z" fill="#fcc419" />
        </g>
      )}
      {variant === 'headphones' && (
        <g>
          <path d="M22 58 q0 -46 38 -46 q38 0 38 46" fill="none" stroke="#343a40" strokeWidth="6" strokeLinecap="round" />
          <rect x="12" y="50" width="16" height="24" rx="7" fill="#5f3dc4" />
          <rect x="92" y="50" width="16" height="24" rx="7" fill="#5f3dc4" />
        </g>
      )}
    </g>
  );
}

export function RaccoonAvatar({ variant = 'classic', size = 48, title }: { variant?: string; size?: number; title?: string }) {
  const v: Avatar = isAvatar(variant) ? variant : 'classic';
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title ?? `${AVATAR_LABELS[v]} raccoon`}>
      <Head variant={v} />
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
      <ellipse cx="110" cy="172" rx="50" ry="46" fill="#a3aab1" />
      <ellipse cx="110" cy="184" rx="30" ry="26" fill="#f4f4f2" />
      {/* broom */}
      <rect x="150" y="96" width="7" height="90" rx="3.5" fill="#8b5e3c" transform="rotate(-28 153 141)" />
      <path d="M190 172 l38 6 l-6 14 l-40 -4z" fill="#f2c14e" stroke="#c9a227" strokeWidth="2" />
      <path d="M146 150 q20 2 34 14" stroke="#a3aab1" strokeWidth="15" strokeLinecap="round" fill="none" />
      {/* striped tail */}
      <g transform="translate(40 158) rotate(-35)">
        <ellipse cx="0" cy="0" rx="14" ry="40" fill="#a3aab1" />
        <rect x="-14" y="-28" width="28" height="9" fill="#3a3f44" />
        <rect x="-14" y="-8" width="28" height="9" fill="#3a3f44" />
        <rect x="-13" y="12" width="26" height="9" fill="#3a3f44" />
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
