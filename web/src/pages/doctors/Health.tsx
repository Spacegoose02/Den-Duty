// The health card: allergies, conditions, blood type, insurance and emergency notes, the care team with tap-to-call,
// vaccines and a growth chart. Everything a babysitter or an ER visit needs, on one screen.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useApp } from '../../state.tsx';
import { Modal } from '../../components/Bits.tsx';
import { LineChart } from '../../components/Charts.tsx';
import type { MedRow } from './Meds.tsx';

export interface HealthProfile {
  allergies: string | null; conditions: string | null; bloodType: string | null; insurance: string | null; insuranceMember: string | null;
  insuranceGroup: string | null; emergency: string | null; updatedAt: string | null;
}
export interface Contact { id: string; name: string; role: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null }
export interface HealthData {
  today: string; profile: HealthProfile; careTeam: Contact[];
  vaccines: { id: string; name: string; date: string; dose: string | null; notes: string | null }[];
  growth: { id: string; date: string; heightCm: number | null; weightKg: number | null }[];
  meds: MedRow[];
}

type Units = 'metric' | 'us';
const UNITS_KEY = 'dd-units';
const loadUnits = (): Units => (localStorage.getItem(UNITS_KEY) === 'us' ? 'us' : 'metric');
export const heightText = (cm: number | null, u: Units) => cm == null ? '' : u === 'us' ? `${Math.floor(cm / 2.54 / 12)} ft ${Math.round((cm / 2.54) % 12)} in` : `${cm} cm`;
export const weightText = (kg: number | null, u: Units) => kg == null ? '' : u === 'us' ? `${Math.round(kg * 2.20462 * 10) / 10} lb` : `${kg} kg`;

const YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** Health records span years, so their dates show the year. */
export const yearDate = (iso: string) => YEAR_FMT.format(new Date(`${iso}T00:00:00Z`));
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLabel = (iso: string) => MONTH_FMT.format(new Date(`${iso}T00:00:00Z`));

const ROLES = ['Pediatrician', 'Dentist', 'Speech therapist', 'Occupational therapist', 'Physical therapist', 'Behavior therapist', 'Specialist', 'Pharmacy', 'School nurse', 'Emergency contact'];

function ProfileForm({ profile, onSave, onClose }: { profile: HealthProfile; onSave: (p: HealthProfile) => Promise<void>; onClose: () => void }) {
  const [p, setP] = useState(profile);
  const field = (k: keyof HealthProfile, label: string, ph: string, long = false) => (
    <label className="field">{label}
      {long
        ? <textarea value={p[k] ?? ''} placeholder={ph} onChange={(e) => setP({ ...p, [k]: e.target.value })} style={{ minHeight: 60 }} />
        : <input value={p[k] ?? ''} placeholder={ph} onChange={(e) => setP({ ...p, [k]: e.target.value })} />}
    </label>
  );
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(p); }}>
        <h2 style={{ margin: 0 }}>Health card</h2>
        {field('allergies', '⚠️ Allergies', 'e.g. Peanuts (EpiPen in backpack), penicillin', true)}
        {field('conditions', '🩺 Conditions and diagnoses', 'e.g. Asthma, speech delay', true)}
        {field('bloodType', '🩸 Blood type', 'e.g. O+')}
        {field('insurance', '🪪 Insurance', 'Plan name')}
        <div className="row">
          <div style={{ flex: 1 }}>{field('insuranceMember', 'Member ID', '')}</div>
          <div style={{ flex: 1 }}>{field('insuranceGroup', 'Group number', '')}</div>
        </div>
        {field('emergency', '🚑 For a babysitter or the ER', 'e.g. Inhaler in the kitchen drawer; calm her with her blue blanket', true)}
        <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

function ContactForm({ initial, onSave, onClose, onDelete }: { initial?: Contact; onSave: (c: Omit<Contact, 'id'>) => Promise<void>; onClose: () => void; onDelete?: () => Promise<void> }) {
  const [c, setC] = useState<Omit<Contact, 'id'>>(initial ?? { name: '', role: 'Pediatrician', phone: '', email: '', address: '', notes: '' });
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(c); }}>
        <h2 style={{ margin: 0 }}>{initial ? 'Edit contact' : 'Add to the care team'}</h2>
        <input placeholder="Name, e.g. Dr. Patel or Sunny Pediatrics" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus />
        <div className="chips">{ROLES.map((r) => <button key={r} type="button" className={`chip${c.role === r ? ' on' : ''}`} onClick={() => setC({ ...c, role: r })}>{r}</button>)}</div>
        <input placeholder="Or type a role" value={c.role ?? ''} onChange={(e) => setC({ ...c, role: e.target.value })} />
        <input type="tel" placeholder="Phone" value={c.phone ?? ''} onChange={(e) => setC({ ...c, phone: e.target.value })} />
        <input type="email" placeholder="Email (optional)" value={c.email ?? ''} onChange={(e) => setC({ ...c, email: e.target.value })} />
        <input placeholder="Address (optional)" value={c.address ?? ''} onChange={(e) => setC({ ...c, address: e.target.value })} />
        <textarea placeholder="Notes, e.g. portal login hint, after-hours line" value={c.notes ?? ''} onChange={(e) => setC({ ...c, notes: e.target.value })} style={{ minHeight: 60 }} />
        <div className="row">
          {onDelete && <button type="button" className="ghost danger" onClick={() => { if (confirm('Remove this contact?')) void onDelete(); }}>Remove</button>}
          <span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!c.name.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function HealthTab({ kid, data, reload, color }: { kid: { id: string; name: string; birthdate: string | null }; data: HealthData; reload: () => Promise<void>; color: string }) {
  const { base, toast } = useApp();
  const [editing, setEditing] = useState<'profile' | 'contact' | Contact | 'vaccine' | 'growth' | null>(null);
  const [units, setUnits] = useState<Units>(loadUnits);
  const [vax, setVax] = useState({ name: '', date: data.today, dose: '' });
  const [g, setG] = useState({ date: data.today, height: '', weight: '' });
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); setEditing(null); await reload(); } catch (e) { toast((e as Error).message); } };
  const k = `${base}/kids/${kid.id}/health`;
  const p = data.profile;
  const switchUnits = (u: Units) => { localStorage.setItem(UNITS_KEY, u); setUnits(u); };
  const heights = data.growth.filter((x) => x.heightCm != null);
  const weights = data.growth.filter((x) => x.weightKg != null);
  const activeMeds = data.meds.filter((m) => m.active);

  return (
    <div className="stack">
      <section className="card stack health-card">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>🪪 {kid.name}'s health card</h2>
          <button className="ghost no-print" onClick={() => window.print()}>🖨️ Print</button>
          <button className="primary no-print" onClick={() => setEditing('profile')}>Edit</button>
        </div>
        <div className="grid-2">
          <div><div className="small muted">⚠️ Allergies</div><strong style={{ color: p.allergies ? 'var(--danger)' : undefined }}>{p.allergies || 'None listed'}</strong></div>
          <div><div className="small muted">🩺 Conditions</div><div>{p.conditions || 'None listed'}</div></div>
          <div><div className="small muted">💊 Medicines now</div><div>{activeMeds.length ? activeMeds.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`).join(', ') : 'None'}</div></div>
          <div><div className="small muted">🎂 Born · 🩸 Blood type</div><div>{kid.birthdate ? yearDate(kid.birthdate) : '—'} · {p.bloodType || '—'}</div></div>
          <div><div className="small muted">🪪 Insurance</div><div>{p.insurance || '—'}{p.insuranceMember && ` · ID ${p.insuranceMember}`}{p.insuranceGroup && ` · Group ${p.insuranceGroup}`}</div></div>
          {p.emergency && <div><div className="small muted">🚑 For a babysitter or the ER</div><div>{p.emergency}</div></div>}
        </div>
      </section>

      <section className="card stack">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>📇 Care team</h2>
          <button className="ghost no-print" onClick={() => setEditing('contact')}>＋ Contact</button>
        </div>
        {!data.careTeam.length && <p className="muted" style={{ margin: 0 }}>Add the pediatrician, dentist, therapists and pharmacy, so their numbers are one tap away.</p>}
        {data.careTeam.map((c) => (
          <div key={c.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong>{c.name}</strong>{c.role && <span className="muted"> · {c.role}</span>}
              {(c.address || c.notes) && <div className="small muted">{[c.address, c.notes].filter(Boolean).join(' · ')}</div>}
            </div>
            {c.phone && <a className="pill" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>📞 {c.phone}</a>}
            {c.email && <a className="pill" href={`mailto:${c.email}`}>✉️ Email</a>}
            <button className="ghost no-print" onClick={() => setEditing(c)}>Edit</button>
          </div>
        ))}
      </section>

      <div className="grid-2">
        <section className="card stack">
          <div className="row">
            <h2 style={{ margin: 0, flex: 1 }}>📏 Growth</h2>
            <div className="seg no-print">
              <button className={units === 'metric' ? 'on' : ''} onClick={() => switchUnits('metric')}>cm/kg</button>
              <button className={units === 'us' ? 'on' : ''} onClick={() => switchUnits('us')}>in/lb</button>
            </div>
          </div>
          {heights.length >= 2 && (
            <LineChart height={150} unit={units === 'us' ? ' in' : ' cm'} labels={heights.map((x) => monthLabel(x.date))}
              series={[{ id: 'h', name: 'Height', color, values: heights.map((x) => units === 'us' ? Math.round((x.heightCm! / 2.54) * 10) / 10 : x.heightCm!) }]} />
          )}
          {weights.length >= 2 && (
            <LineChart height={150} unit={units === 'us' ? ' lb' : ' kg'} labels={weights.map((x) => monthLabel(x.date))}
              series={[{ id: 'w', name: 'Weight', color: 'var(--accent, var(--primary))', values: weights.map((x) => units === 'us' ? Math.round(x.weightKg! * 2.20462 * 10) / 10 : x.weightKg!) }]} />
          )}
          {[...data.growth].reverse().slice(0, 6).map((x) => (
            <div key={x.id} className="list-item small">
              <span style={{ flex: 1 }}>{yearDate(x.date)}</span>
              <span>{[heightText(x.heightCm, units), weightText(x.weightKg, units)].filter(Boolean).join(' · ')}</span>
              <button className="ghost danger no-print" aria-label="Delete" onClick={() => void run(() => api(`${base}/health/growth/${x.id}`, { method: 'DELETE' }))}>✕</button>
            </div>
          ))}
          {!data.growth.length && <p className="muted small" style={{ margin: 0 }}>Add height and weight from checkups to see a chart.</p>}
          <form className="row no-print" onSubmit={(e) => {
            e.preventDefault();
            const toCm = (v: string) => v === '' ? null : units === 'us' ? Number(v) * 2.54 : Number(v);
            const toKg = (v: string) => v === '' ? null : units === 'us' ? Number(v) / 2.20462 : Number(v);
            void run(async () => { await api(`${k}/growth`, { body: { date: g.date, heightCm: toCm(g.height), weightKg: toKg(g.weight) } }); setG({ ...g, height: '', weight: '' }); }, 'Saved');
          }}>
            <input type="date" value={g.date} onChange={(e) => setG({ ...g, date: e.target.value })} style={{ width: 160 }} aria-label="Date" />
            <input type="number" step="0.1" min={0} placeholder={units === 'us' ? 'inches' : 'cm'} value={g.height} onChange={(e) => setG({ ...g, height: e.target.value })} style={{ width: 100 }} aria-label="Height" />
            <input type="number" step="0.1" min={0} placeholder={units === 'us' ? 'lb' : 'kg'} value={g.weight} onChange={(e) => setG({ ...g, weight: e.target.value })} style={{ width: 100 }} aria-label="Weight" />
            <button disabled={!g.height && !g.weight}>Add</button>
          </form>
        </section>

        <section className="card stack">
          <h2 style={{ margin: 0 }}>💉 Vaccines</h2>
          {data.vaccines.map((v) => (
            <div key={v.id} className="list-item small">
              <span style={{ flex: 1 }}><strong>{v.name}</strong>{v.dose && ` · ${v.dose}`}</span>
              <span className="muted">{yearDate(v.date)}</span>
              <button className="ghost danger no-print" aria-label="Delete" onClick={() => { if (confirm('Delete this vaccine?')) void run(() => api(`${base}/health/vaccines/${v.id}`, { method: 'DELETE' })); }}>✕</button>
            </div>
          ))}
          {!data.vaccines.length && <p className="muted small" style={{ margin: 0 }}>Keep a record of shots and boosters here.</p>}
          <form className="row no-print" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`${k}/vaccines`, { body: vax }); setVax({ ...vax, name: '', dose: '' }); }, 'Saved'); }}>
            <input placeholder="e.g. Flu, MMR" value={vax.name} onChange={(e) => setVax({ ...vax, name: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
            <input placeholder="Dose #" value={vax.dose} onChange={(e) => setVax({ ...vax, dose: e.target.value })} style={{ width: 80 }} />
            <input type="date" value={vax.date} onChange={(e) => setVax({ ...vax, date: e.target.value })} style={{ width: 160 }} aria-label="Date given" />
            <button disabled={!vax.name.trim() || !vax.date}>Add</button>
          </form>
        </section>
      </div>

      {editing === 'profile' && <ProfileForm profile={p} onClose={() => setEditing(null)} onSave={(np) => run(() => api(`${k}/profile`, { method: 'PUT', body: np }), 'Health card saved')} />}
      {editing === 'contact' && <ContactForm onClose={() => setEditing(null)} onSave={(c) => run(() => api(`${k}/care-team`, { body: c }), 'Added')} />}
      {editing && typeof editing === 'object' && (
        <ContactForm initial={editing} onClose={() => setEditing(null)} onSave={(c) => run(() => api(`${base}/health/care-team/${editing.id}`, { method: 'PATCH', body: c }), 'Saved')}
          onDelete={() => run(() => api(`${base}/health/care-team/${editing.id}`, { method: 'DELETE' }), 'Removed')} />
      )}
    </div>
  );
}
