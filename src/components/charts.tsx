// Small dependency-free SVG charts. Server- and client-safe (no hooks).
import { cn } from "@/components/ui";

export type ChartPoint = { x: string | number; y: number };
export type ChartSeries = { label: string; points: ChartPoint[]; className?: string };

const SERIES_CLASSES = ["text-brand", "text-sky-500", "text-emerald-500", "text-amber-500", "text-violet-500"];

function toNum(x: string | number): number {
  return typeof x === "number" ? x : Date.parse(x.length === 10 ? `${x}T00:00:00Z` : x);
}

function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function defaultXLabel(x: string | number): string {
  if (typeof x === "number") return fmt(x);
  const d = new Date(x.length === 10 ? `${x}T00:00:00Z` : x);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Multi-series line chart. X values may be dates ("YYYY-MM-DD"/ISO) or numbers
 * and are spaced proportionally. Renders an accessible summary table for
 * screen readers.
 */
export function LineChart({
  series,
  height = 220,
  unit,
  title,
  formatX = defaultXLabel,
  className,
}: {
  series: ChartSeries[];
  height?: number;
  unit?: string;
  title: string;
  formatX?: (x: string | number) => string;
  className?: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return (
      <div className={cn("flex items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-zinc-700", className)} style={{ height }}>
        No data yet
      </div>
    );
  }

  const W = 640;
  const H = height;
  const pad = { top: 12, right: 16, bottom: 28, left: 44 };
  const xs = all.map((p) => toNum(p.x));
  const ys = all.map((p) => p.y);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const step = niceStep(yMax - yMin, 4);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) yTicks.push(Number(v.toFixed(6)));

  const sx = (x: number) => pad.left + ((x - xMin) / (xMax - xMin)) * (W - pad.left - pad.right);
  const sy = (y: number) => pad.top + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.top - pad.bottom);

  const longest = series.reduce((a, s) => (s.points.length > a.points.length ? s : a), series[0]!);
  const sortedX = [...new Set(longest.points.map((p) => p.x))].sort((a, b) => toNum(a) - toNum(b));
  const xLabelIdx = sortedX.length <= 4 ? sortedX.map((_, i) => i) : [0, Math.floor((sortedX.length - 1) / 3), Math.floor(((sortedX.length - 1) * 2) / 3), sortedX.length - 1];

  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        <title>{title}</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={sy(t)} y2={sy(t)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
            <text x={pad.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[11px]">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xLabelIdx.map((i) => {
          const x = sortedX[i]!;
          return (
            <text key={`${x}-${i}`} x={sx(toNum(x))} y={H - 8} textAnchor={i === 0 ? "start" : i === sortedX.length - 1 ? "end" : "middle"} className="fill-zinc-500 text-[11px]">
              {formatX(x)}
            </text>
          );
        })}
        {series.map((s, si) => {
          const pts = [...s.points].sort((a, b) => toNum(a.x) - toNum(b.x));
          const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(toNum(p.x)).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
          return (
            <g key={s.label} className={s.className ?? SERIES_CLASSES[si % SERIES_CLASSES.length]}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={sx(toNum(p.x))} cy={sy(p.y)} r={pts.length > 40 ? 2 : 3.5} fill="currentColor">
                  <title>{`${s.label}: ${fmt(p.y)}${unit ? ` ${unit}` : ""} · ${formatX(p.x)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {series.length > 1 ? (
        <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
          {series.map((s, si) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded-full bg-current", s.className ?? SERIES_CLASSES[si % SERIES_CLASSES.length])} />
              {s.label}
            </span>
          ))}
        </figcaption>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {series.flatMap((s) =>
            s.points.map((p, i) => (
              <tr key={`${s.label}-${i}`}>
                <th scope="row">{`${s.label} ${formatX(p.x)}`}</th>
                <td>{`${fmt(p.y)}${unit ? ` ${unit}` : ""}`}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </figure>
  );
}

/** Tiny inline trend line. Values are plotted in order, evenly spaced. */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  label,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
  className?: string;
}) {
  if (values.length < 2) {
    return <span className="text-xs text-zinc-400">{values.length ? "Need more data" : "No data"}</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const p = 3;
  const pts = values.map((v, i) => [p + (i / (values.length - 1)) * (width - 2 * p), p + (1 - (v - min) / span) * (height - 2 * p)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("text-brand", className)} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />
    </svg>
  );
}

/** Horizontal progress bar (0-100). */
export function ProgressBar({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
