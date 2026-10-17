// Just enough iCalendar (RFC 5545) to publish chore calendars and read school-lunch and meal-plan feeds.

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string | null;
  /** 'YYYY-MM-DD' for all-day events; with `time`, a wall-clock time in `tz` (or the home's zone). */
  date: string;
  time?: string | null; // 'HH:MM'
  /** For timed events. */
  durationMinutes?: number | null;
  /** All-day events spanning several days end the day before this (exclusive), like iCalendar. */
  endDate?: string | null;
}

// ---------- writing ----------

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded with a leading space (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; curLen = 0; }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compactDate = (d: string) => d.replace(/-/g, '');

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const t = new Date(`${date}T${time}:00Z`);
  t.setUTCMinutes(t.getUTCMinutes() + minutes);
  return { date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16) };
}

const nextDay = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

export function buildIcs(calName: string, tz: string, events: IcsEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daytime Ninja//Chores//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calName)}`, `X-WR-TIMEZONE:${tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(e.summary)}`);
    if (e.time) {
      const end = addMinutes(e.date, e.time, e.durationMinutes ?? 60);
      lines.push(`DTSTART;TZID=${tz}:${compactDate(e.date)}T${e.time.replace(':', '')}00`, `DTEND;TZID=${tz}:${compactDate(end.date)}T${end.time.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(e.endDate ?? nextDay(e.date))}`, 'TRANSP:TRANSPARENT');
    }
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ---------- reading ----------

const unescapeText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Wall-clock date and time of a UTC instant in a time zone. */
function inZone(utc: Date, tz: string): { date: string; time: string } {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(utc).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch {
    return { date: utc.toISOString().slice(0, 10), time: utc.toISOString().slice(11, 16) };
  }
}

interface Prop { name: string; params: Record<string, string>; value: string }

function parseProp(line: string): Prop | null {
  // NAME;PARAM=x;PARAM2="y":value  (the colon after any quoted params starts the value)
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  return {
    name: name.toUpperCase(),
    params: Object.fromEntries(params.map((p) => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=').replace(/^"|"$/g, '')]; })),
    value: line.slice(colon + 1),
  };
}

/** Turns a DTSTART/DTEND value into a date (and time) in the home's zone. */
function when(p: Prop, homeTz: string): { date: string; time: string | null } | null {
  const v = p.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || p.params.VALUE === 'DATE') return { date, time: null };
  if (m[7]) return inZone(new Date(`${date}T${m[4]}:${m[5]}:${m[6] ?? '00'}Z`), homeTz);
  // Floating or TZID times: shown as written. Feeds almost always use the school's or home's own zone.
  return { date, time: `${m[4]}:${m[5]}` };
}

/**
 * Parses VEVENTs. Repeating events (RRULE) are shown on their first date only; school lunch menus and Nighttime
 * Ninja's meal plan publish one event per day, so this covers them.
 */
export function parseIcs(text: string, homeTz: string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: IcsEvent[] = [];
  let cur: Prop[] | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const get = (n: string) => cur!.find((p) => p.name === n);
        const start = get('DTSTART') ? when(get('DTSTART')!, homeTz) : null;
        const status = get('STATUS')?.value.toUpperCase();
        if (start && status !== 'CANCELLED') {
          const end = get('DTEND') ? when(get('DTEND')!, homeTz) : null;
          let durationMinutes: number | null = null;
          if (start.time && end?.time) {
            durationMinutes = Math.max(0, Math.round((Date.parse(`${end.date}T${end.time}:00Z`) - Date.parse(`${start.date}T${start.time}:00Z`)) / 60000));
          }
          out.push({
            uid: get('UID')?.value ?? `${start.date}-${out.length}`,
            summary: unescapeText(get('SUMMARY')?.value ?? '').trim() || '(no title)',
            description: get('DESCRIPTION') ? unescapeText(get('DESCRIPTION')!.value).trim() : null,
            date: start.date,
            time: start.time,
            durationMinutes,
            endDate: !start.time && end && end.date > nextDay(start.date) ? end.date : null,
          });
        }
      }
      cur = null;
      continue;
    }
    if (cur) {
      const p = parseProp(line);
      if (p) cur.push(p);
    }
  }
  return out;
}
