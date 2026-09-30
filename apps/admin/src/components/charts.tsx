import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Small, dependency-free charts for the reports. One series each, in the accent
// colour; values and labels wear text colours, never the series colour.

function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis steps (1, 2, 2.5, 5 x 10^n) covering min..max. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** A bar with 4px rounding on its data end only, flat on the baseline. */
function barPath(x: number, w: number, base: number, end: number) {
  const up = end <= base;
  const h = Math.abs(base - end);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return '';
  return up
    ? `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + r}V${base}Z`
    : `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end - r}V${base}Z`;
}

export interface BarDatum { key: string; label: string; value: number; tooltip: ReactNode }

export function BarChart({ data, formatAxis, height = 240, title }: {
  data: BarDatum[]; formatAxis: (v: number) => string; height?: number; title: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const padL = Math.max(...ticks.map((t) => formatAxis(t).length)) * 6.5 + 12, padR = 4, padT = 10, padB = 26;
  const plotW = Math.max(width - padL - padR, 10), plotH = height - padT - padB;
  const y = (v: number) => padT + ((hi - v) / (hi - lo || 1)) * plotH;
  const step = plotW / Math.max(data.length, 1);
  const barW = Math.max(1, Math.min(48, step - 2)); // 2px surface gap between bars
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 70))));
  const h = hover === null ? null : data[hover];
  const tipX = hover === null ? 0 : Math.min(Math.max(padL + hover * step + step / 2, 120), width - 120);

  return (
    <div ref={ref} className="relative select-none" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1 : 0.75}
              strokeDasharray={t === 0 ? undefined : '2 3'} />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--faint)] text-[11px] tabular-nums">{formatAxis(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          return (
            <g key={d.key}>
              <path d={barPath(x, barW, y(0), y(d.value))} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.45} />
              {i % every === 0 && (
                <text x={padL + i * step + step / 2} y={height - 8} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">{d.label}</text>
              )}
              {/* Hit target: the whole column, wider than the bar. */}
              <rect x={padL + i * step} y={padT} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {h && (
        <div role="status" className="pointer-events-none absolute top-0 z-10 w-60 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: tipX }}>
          {h.tooltip}
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Weekday x hour grid; one hue, light to dark, with a legend. */
export function Heatmap({ cells, format }: {
  cells: { weekday: number; hour: number; orders: number; net_sales: number }[]; format: (v: number) => string;
}) {
  const [tip, setTip] = useState<{ d: number; h: number } | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  const max = Math.max(0, ...cells.map((c) => c.net_sales));
  const level = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 5)));
  const shade = (l: number) => (l === 0 ? 'var(--surface-2)' : `color-mix(in oklab, var(--accent) ${l * 20}%, var(--surface))`);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const t = tip ? byKey.get(`${tip.d}-${tip.h}`) : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: '2.5rem repeat(24, minmax(0, 1fr))' }}
          onMouseLeave={() => setTip(null)} role="img" aria-label="Sales by weekday and hour">
          <div />
          {hours.map((h) => <div key={h} className="text-center text-[10px] text-faint">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>)}
          {WEEKDAYS.map((name, di) => (
            <div key={name} className="contents">
              <div className="pr-1 text-right text-[11px] leading-6 text-muted">{name}</div>
              {hours.map((h) => {
                const c = byKey.get(`${di + 1}-${h}`);
                return (
                  <div key={h} className="h-6 rounded-[2px]" style={{ background: shade(level(c?.net_sales ?? 0)) }}
                    onMouseEnter={() => setTip({ d: di + 1, h })} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="min-h-4" role="status">
          {tip && <>{WEEKDAYS[tip.d - 1]} {String(tip.h).padStart(2, '0')}:00-{String(tip.h + 1).padStart(2, '0')}:00 ·{' '}
            {t ? <><span className="font-medium text-text">{format(t.net_sales)}</span> from {t.orders} sale{t.orders === 1 ? '' : 's'}</> : 'no sales'}</>}
        </span>
        <span className="flex items-center gap-1.5">Less
          {[0, 1, 2, 3, 4, 5].map((l) => <span key={l} className="size-3 rounded-[2px]" style={{ background: shade(l) }} />)}
          More</span>
      </div>
    </div>
  );
}

/** A thin share-of-total bar for table cells. */
export function ShareBar({ percent }: { percent: number | null }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${p}%` }} /></div>
      <span className="w-10 text-right text-xs tabular-nums text-muted">{percent === null ? '-' : `${percent}%`}</span>
    </div>
  );
}
