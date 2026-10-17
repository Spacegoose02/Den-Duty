import { useEffect, useState, type ReactNode } from 'react';
import type { AgendaItem } from '../api.ts';

export function Modal({ children, onClose, wide = false }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={wide ? { width: 'min(760px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ percent, color }: { percent: number; color?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }} />
    </div>
  );
}

/** Big-button number pad for kids' 4-digit PINs. Calls onDone as soon as the fourth digit is in. */
export function PinPad({ onDone, error }: { onDone: (pin: string) => void; error?: string | null }) {
  const [pin, setPin] = useState('');
  useEffect(() => { if (error) setPin(''); }, [error]);
  const press = (d: string) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) onDone(next);
  };
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <div className="pin-dots" aria-label={`${pin.length} of 4 digits`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {error && <p style={{ color: 'var(--danger)', margin: 0, fontWeight: 700 }}>{error}</p>}
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        <button className="ghost" onClick={() => setPin('')} aria-label="Clear">✕</button>
        <button onClick={() => press('0')}>0</button>
        <button className="ghost" onClick={() => setPin(pin.slice(0, -1))} aria-label="Back">⌫</button>
      </div>
    </div>
  );
}

export const STATUS_LABEL: Record<AgendaItem['status'], string> = {
  pending: 'To do',
  submitted: 'Waiting for a grown-up',
  approved: 'Done!',
  rejected: 'Try again',
  planned: 'Coming up',
};

/** A big tappable chore card. */
export function ChoreTile({ item, onTap, pointsIcon, busy }: { item: AgendaItem; onTap?: () => void; pointsIcon: string; busy?: boolean }) {
  return (
    <button className={`chore-tile ${item.status}`} onClick={onTap} disabled={!onTap || busy} aria-label={`${item.title}, ${STATUS_LABEL[item.status]}`}>
      <span className="chore-icon" aria-hidden>{item.icon}</span>
      <span className="chore-title">{item.title}</span>
      <span className="chore-points">+{item.points} {pointsIcon}</span>
      <span className="chore-status">
        {item.status === 'approved' ? '✅ ' : item.status === 'submitted' ? '⏳ ' : item.status === 'rejected' ? '🔁 ' : ''}
        {STATUS_LABEL[item.status]}
      </span>
      {item.status === 'rejected' && item.note && <span className="chore-note">“{item.note}”</span>}
    </button>
  );
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const dayName = (iso: string) => DAY_FMT.format(new Date(`${iso}T00:00:00Z`));
export const shortDate = (iso: string) => DATE_FMT.format(new Date(`${iso}T00:00:00Z`));
