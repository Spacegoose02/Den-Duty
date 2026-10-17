import { THEME_DEFS } from '../../../shared/themes.ts';

/**
 * A grid of little theme previews. `inherit` adds a first card for "follow the home" (value null),
 * labeled with what that currently means.
 */
export function ThemePicker({ value, onPick, inherit }: { value: string | null; onPick: (id: string | null) => void; inherit?: { label: string; theme: string } }) {
  return (
    <div className="theme-grid">
      {inherit && (
        <button type="button" className={`theme-card${value == null ? ' on' : ''}`} data-theme={inherit.theme} onClick={() => onPick(null)}>
          <ThemeSwatch />
          <span className="theme-name">{inherit.label}</span>
        </button>
      )}
      {THEME_DEFS.map((t) => (
        <button key={t.id} type="button" className={`theme-card${value === t.id ? ' on' : ''}`} data-theme={t.id} onClick={() => onPick(t.id)} title={t.vibe}>
          <ThemeSwatch />
          <span className="theme-name">{t.name}</span>
          <span className="theme-vibe">{t.vibe}</span>
        </button>
      ))}
    </div>
  );
}

/** Drawn with the card's own theme variables, so each card previews itself. */
function ThemeSwatch() {
  return (
    <span className="theme-swatch" aria-hidden>
      <span style={{ background: 'var(--surface)' }} />
      <span style={{ background: 'var(--primary)' }} />
      <span style={{ background: 'var(--surface-2)' }} />
    </span>
  );
}
