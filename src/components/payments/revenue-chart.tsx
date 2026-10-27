import { formatMoney } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;

/** Simple SVG bar chart of monthly revenue (net of refunds). */
export function RevenueChart({ data, currency = "usd" }: { data: { month: string; cents: number }[]; currency?: string }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 8, bottom: 28, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.cents));
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(6, slot * 0.62);
  const total = data.reduce((s, d) => s + d.cents, 0);

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Revenue for the last ${data.length} months, ${formatMoney(total, currency)} total`}
        className="h-auto w-full text-brand"
      >
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} className="stroke-zinc-200 dark:stroke-zinc-800" />
        {data.map((d, i) => {
          const h = (d.cents / max) * innerH;
          const x = pad.left + i * slot + (slot - barW) / 2;
          const y = pad.top + innerH - h;
          const last = i === data.length - 1;
          return (
            <g key={d.month}>
              <title>{`${monthLabel(d.month)} ${d.month.slice(0, 4)}: ${formatMoney(d.cents, currency)}`}</title>
              <rect
                x={x}
                y={d.cents > 0 ? y : pad.top + innerH - 1}
                width={barW}
                height={d.cents > 0 ? Math.max(2, h) : 1}
                rx={4}
                className={last ? "fill-current" : "fill-current opacity-40"}
              />
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="fill-zinc-500 text-[11px]">
                {monthLabel(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <table>
          <caption>Monthly revenue</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <th scope="row">{d.month}</th>
                <td>{formatMoney(d.cents, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
