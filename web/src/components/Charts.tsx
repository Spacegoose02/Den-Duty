// Small, dependency-free SVG charts. One axis per chart, thin marks, quiet grid, hover tooltips and a table view.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface Series { id: string; name: string; color: string; values: number[] }

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clean tick values from 0 to a round number at or above max. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6));
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(Math.round(n * 10) / 10));

interface Tip { x: number; y: number; content: ReactNode }

function Frame({ children, tip, height }: { children: ReactNode; tip: Tip | null; height: number }) {
  return (
    <div className="chart-frame" style={{ height }}>
      {children}
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.content}</div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: Pick<Series, 'id' | 'name' | 'color'>[] }) {
  return (
    <div className="chart-legend">
      {series.map((s) => <span key={s.id}><i style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );
}

/** Data as a table, for screen readers, print, and anyone who'd rather read numbers. */
export function ChartTable({ labels, series, label = 'Table' }: { labels: string[]; series: Pick<Series, 'id' | 'name' | 'values'>[]; label?: string }) {
  return (
    <details className="chart-table">
      <summary>{label}</summary>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th />{series.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
          <tbody>
            {labels.map((l, i) => <tr key={l + i}><td>{l}</td>{series.map((s) => <td key={s.id}>{fmt(s.values[i] ?? 0)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 12, right: 64, bottom: 26, left: 36 };

/** Change over time for one or more series. Up to 4 series also get labels at the line ends. */
export function LineChart({ labels, series, height = 240, unit = '' }: { labels: string[]; series: Series[]; height?: number; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ys = ticks(max);
  const top = ys[ys.length - 1];
  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (labels.length <= 1 ? w / 2 : (i / (labels.length - 1)) * w);
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 70))));
  const tip: Tip | null = hover == null ? null : {
    x: Math.min(x(hover) + 10, width - 170), y: PAD.top,
    content: (
      <>
        <strong>{labels[hover]}</strong>
        {series.map((s) => <div key={s.id} className="tip-row"><i style={{ background: s.color }} />{s.name}<b>{fmt(s.values[hover] ?? 0)}{unit}</b></div>)}
      </>
    ),
  };
  return (
    <div ref={ref}>
      <Frame tip={tip} height={height}>
        <svg width={width} height={height} role="img" aria-label={`Line chart: ${series.map((s) => s.name).join(', ')}`}
          onMouseLeave={() => setHover(null)}>
          {ys.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + w} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{fmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => i % every === 0 && <text key={l + i} x={x(i)} y={height - 6} textAnchor="middle" className="chart-axis">{l}</text>)}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h} className="chart-crosshair" />}
          {series.map((s) => (
            <g key={s.id}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
              {(hover != null ? [hover] : [s.values.length - 1]).map((i) => (
                <circle key={i} cx={x(i)} cy={y(s.values[i] ?? 0)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
              {series.length <= 4 && (
                <text x={x(s.values.length - 1) + 9} y={y(s.values.at(-1) ?? 0) + 4} className="chart-label">{s.name}</text>
              )}
            </g>
          ))}
          {/* Hover bands wider than the marks. */}
          {labels.map((l, i) => (
            <rect key={`hit-${l}-${i}`} x={x(i) - w / Math.max(1, labels.length - 1) / 2} y={PAD.top} width={w / Math.max(1, labels.length - 1)} height={h}
              fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
          ))}
        </svg>
      </Frame>
      {series.length >= 2 && <Legend series={series} />}
    </div>
  );
}

/**
 * Columns from one baseline. With two segments they stack (e.g. done + missed) with a 2px surface gap,
 * and only the top of the stack is rounded.
 */
export function ColumnChart({ labels, segments, height = 220, unit = '' }: { labels: string[]; segments: Series[]; height?: number; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => segments.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const ys = ticks(Math.max(1, ...totals));
  const top = ys[ys.length - 1];
  const pad = { ...PAD, right: 12 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const band = w / Math.max(1, labels.length);
  const bw = Math.min(24, Math.max(3, band - 4));
  const y = (v: number) => pad.top + h - (v / top) * h;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 56))));
  const tip: Tip | null = hover == null ? null : {
    x: Math.min(pad.left + band * hover + band / 2 + 10, width - 170), y: pad.top,
    content: (
      <>
        <strong>{labels[hover]}</strong>
        {segments.map((s) => <div key={s.id} className="tip-row"><i style={{ background: s.color }} />{s.name}<b>{fmt(s.values[hover] ?? 0)}{unit}</b></div>)}
      </>
    ),
  };
  return (
    <div ref={ref}>
      <Frame tip={tip} height={height}>
        <svg width={width} height={height} role="img" aria-label={`Column chart: ${segments.map((s) => s.name).join(', ')}`} onMouseLeave={() => setHover(null)}>
          {ys.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{fmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = pad.left + band * i + band / 2;
            let base = 0;
            const visible = segments.map((s) => Math.max(0, s.values[i] ?? 0));
            const lastIdx = visible.reduce((last, v, k) => (v > 0 ? k : last), -1);
            return (
              <g key={l + i} opacity={hover == null || hover === i ? 1 : 0.55}>
                {segments.map((s, k) => {
                  const v = visible[k];
                  if (!v) return null;
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base) + (k < lastIdx ? 2 : 0); // 2px surface gap between stacked segments
                  const hh = Math.max(1, y0 - y1);
                  const r = k === lastIdx ? Math.min(4, bw / 2, hh) : 0;
                  return <path key={s.id} fill={s.color} d={roundedTop(cx - bw / 2, y1, bw, hh, r)} />;
                })}
                {i % every === 0 && <text x={cx} y={height - 6} textAnchor="middle" className="chart-axis">{l}</text>}
                <rect x={pad.left + band * i} y={pad.top} width={band} height={h} fill="transparent"
                  onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      </Frame>
      {segments.length >= 2 && <Legend series={segments} />}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (!r) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}V${y + h}z`;
}

/** Horizontal progress bars with the value at the tip, for ranked lists like "which chores get done". */
export function BarList({ rows, color }: { rows: { key: string; label: ReactNode; value: number; max: number; note: string }[]; color: string }) {
  return (
    <div className="bar-list">
      {rows.map((r) => (
        <div key={r.key} className="bar-row" title={r.note}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${r.max ? (r.value / r.max) * 100 : 0}%`, background: color }} /></span>
          <span className="bar-note">{r.note}</span>
        </div>
      ))}
    </div>
  );
}
