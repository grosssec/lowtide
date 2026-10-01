import { useEffect, useRef, useState, type ReactNode } from 'react';
import { money, shortDate } from '../lib/format.ts';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** 3–5 round ticks (in cents) covering [min, max]. */
function niceTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const steps = [1_000, 2_500, 5_000, 10_000, 20_000, 25_000, 50_000, 100_000, 200_000, 250_000, 500_000, 1_000_000];
  const step = steps.find((s) => span / s <= 4) ?? steps[steps.length - 1];
  const ticks: number[] = [];
  // The last tick must sit at or above the maximum, so the line never leaves the plot.
  for (let t = Math.floor(min / step) * step; ; t += step) {
    ticks.push(t);
    if (t >= max) break;
  }
  return ticks;
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 80, 0), Math.max(0, width - 160));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 w-40 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
      style={{ left }}
    >
      {children}
    </div>
  );
}

export interface RunwayPoint {
  date: string;
  balance: number;
  floor: number;
}

/** Projected balance day by day, the reserve floor, paydays and the tightest day. */
export function Runway({ points, paydays, low }: { points: RunwayPoint[]; paydays: string[]; low?: { date: string; balance: number } }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  const height = 176;
  const axis = 22;
  const gutter = 46;
  const plotW = Math.max(1, width - gutter - 8);
  const plotH = height - axis - 12;
  const values = points.flatMap((p) => [p.balance, p.floor]);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => gutter + (i / (points.length - 1)) * plotW;
  const y = (v: number) => 12 + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
  const floorSegments = points
    .map((p, i) => ({ i, p }))
    .filter(({ p }) => p.floor > 0)
    .map(({ i, p }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.floor).toFixed(1)}`)
    .join('');
  const lowIndex = low ? points.findIndex((p) => p.date === low.date) : -1;
  const labelDates = points.map((p, i) => ({ p, i })).filter(({ p }) => p.date.endsWith('-01') || p.date.endsWith('-15'));
  const hovered = hover === null ? null : points[hover];
  const floorValue = points.find((p) => p.floor > 0)?.floor;

  function onPointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - gutter) / plotW;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Projected balance from ${shortDate(points[0].date)} to ${shortDate(points[points.length - 1].date)}${low ? `, lowest ${money(low.balance)} on ${shortDate(low.date)}` : ''}`}
          onPointerMove={onPointer}
          onPointerLeave={() => setHover(null)}
          className="touch-pan-y"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={gutter} x2={gutter + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--baseline)' : 'var(--line)'} strokeWidth={1} />
              <text x={gutter - 8} y={y(t) + 4} textAnchor="end" className="num fill-muted text-[11px]">
                {money(t)}
              </text>
            </g>
          ))}
          {labelDates.map(({ p, i }) => (
            <text key={p.date} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-muted text-[11px]">
              {shortDate(p.date)}
            </text>
          ))}
          {floorSegments && <path d={floorSegments} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="4 4" />}
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
          {paydays.map((date) => {
            const i = points.findIndex((p) => p.date === date);
            if (i < 0) return null;
            return <path key={date} d={`M${x(i) - 4},${height - axis + 6}l4,-6l4,6z`} fill="var(--series-1)" opacity={0.85} />;
          })}
          {lowIndex >= 0 && (
            <circle cx={x(lowIndex)} cy={y(points[lowIndex].balance)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          )}
          {hover !== null && hovered && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={12} y2={12 + plotH} stroke="var(--baseline)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(hovered.balance)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hovered && hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          <div className="text-muted">{shortDate(hovered.date)}</div>
          <div className="num font-medium text-ink">{money(hovered.balance)}</div>
          {hovered.floor > 0 && <div className="text-muted">reserve {money(hovered.floor)}</div>}
        </Tooltip>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-series-1" /> Balance (bank + cash − card)
        </span>
        {floorValue && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-[1.5px] border-dashed border-ink-2" /> Reserve {money(floorValue)}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 8 6" className="h-1.5 w-2" aria-hidden="true">
            <path d="M0,6l4,-6l4,6z" fill="var(--series-1)" />
          </svg>
          Payday
        </span>
      </div>
    </div>
  );
}

export interface SeriesLine {
  label: string;
  color: string;
  values: number[];
}

/** Month-end balance per scenario, with the reserve as a dashed threshold. */
export function MonthLines({ months, series, floor }: { months: string[]; series: SeriesLine[]; floor: (number | null)[] }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!months.length) return null;

  const height = 220;
  const axis = 22;
  const gutter = 50;
  const right = 12;
  const plotW = Math.max(1, width - gutter - right);
  const plotH = height - axis - 14;
  const all = [...series.flatMap((s) => s.values), ...floor.filter((f): f is number => f !== null)];
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => gutter + (months.length === 1 ? plotW / 2 : (i / (months.length - 1)) * plotW);
  const y = (v: number) => 14 + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * plotH;
  const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const floorPath = floor
    .map((f, i) => (f === null ? null : `${x(i).toFixed(1)},${y(f).toFixed(1)}`))
    .filter(Boolean)
    .map((point, k) => `${k ? 'L' : 'M'}${point}`)
    .join('');
  const every = width < 480 ? 2 : 1;

  function onPointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - gutter) / plotW;
    setHover(Math.min(months.length - 1, Math.max(0, Math.round(ratio * (months.length - 1)))));
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Balance at the end of each month per scenario" onPointerMove={onPointer} onPointerLeave={() => setHover(null)} className="touch-pan-y">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={gutter} x2={gutter + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--baseline)' : 'var(--line)'} />
              <text x={gutter - 8} y={y(t) + 4} textAnchor="end" className="num fill-muted text-[11px]">
                {money(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) =>
            i % every === 0 || i === months.length - 1 ? (
              <text
                key={m}
                x={x(i)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'}
                className="fill-muted text-[11px]"
              >
                {m}
              </text>
            ) : null,
          )}
          {floorPath && <path d={floorPath} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeDasharray="4 4" />}
          {series.map((s) => (
            <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
          ))}
          {series.map((s) => (
            <circle key={`${s.label}-end`} cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={14} y2={14 + plotH} stroke="var(--baseline)" />}
          {hover !== null &&
            series.map((s) => <circle key={`${s.label}-h`} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          <div className="text-muted">End of {months[hover]}</div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num font-medium text-ink">{money(s.values[hover])}</span>
            </div>
          ))}
        </Tooltip>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-[1.5px] border-dashed border-ink-2" /> Reserve
        </span>
      </div>
    </div>
  );
}

export interface BarRow {
  name: string;
  amount: number;
  budget?: number | null;
}

/** One hue for every bar; a budget shows as a tick on the track, overspend gets an icon and words. */
export function BarList({ rows, empty = 'Nothing yet' }: { rows: BarRow[]; empty?: string }) {
  const visible = rows.filter((r) => r.amount > 0 || (r.budget ?? 0) > 0);
  if (!visible.length) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(...visible.map((r) => Math.max(r.amount, r.budget ?? 0)));
  return (
    <ul className="space-y-3">
      {visible.map((row) => {
        const over = row.budget ? row.amount - row.budget : 0;
        return (
          <li key={row.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{row.name}</span>
              <span className="num shrink-0 text-ink">
                {money(row.amount)}
                {row.budget ? <span className="text-muted"> / {money(row.budget)}</span> : null}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-surface-2">
              <div className="h-2 rounded-full bg-series-1" style={{ width: `${(Math.min(row.amount, max) / max) * 100}%` }} />
              {row.budget ? (
                <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `calc(${(row.budget / max) * 100}% - 1px)` }} title={`Budget ${money(row.budget)}`} />
              ) : null}
            </div>
            {over > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
                <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                  <path d="M8 1.6l7 12.6H1z" fill="var(--warning)" />
                </svg>
                {money(over)} over budget
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
