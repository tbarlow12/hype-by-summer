// Commission report: revenue by coach for a date range. Pure (see report.test.ts).
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type CoachRevenueRow = {
  coach_id: string | null;
  payments: number | null;
  gross_cents: number | null;
  refunded_cents: number | null;
  net_cents: number | null;
  platform_fee_cents: number | null;
};

export type CommissionLine = {
  coachId: string | null;
  coachName: string;
  payments: number;
  grossCents: number;
  refundedCents: number;
  netCents: number;
  platformFeeCents: number;
  /** Net after the platform fee: what the business kept. */
  keptCents: number;
  /** Share of the business's net revenue, 0..1. */
  share: number;
};

export type DateRange = { from: string; to: string; fromUtc: Date; toUtc: Date };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inclusive yyyy-MM-dd range in the business's timezone → [fromUtc, toUtc).
 * Defaults to the current month to date; swaps a reversed range; caps at
 * ~3 years.
 */
export function parseDateRange(
  input: { from?: string | null; to?: string | null },
  tz: string,
  now: Date = new Date(),
): DateRange {
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");
  let from = input.from && DAY.test(input.from) ? input.from : `${today.slice(0, 8)}01`;
  let to = input.to && DAY.test(input.to) ? input.to : today;
  if (Number.isNaN(Date.parse(from))) from = `${today.slice(0, 8)}01`;
  if (Number.isNaN(Date.parse(to))) to = today;
  if (from > to) [from, to] = [to, from];
  const fromUtc = fromZonedTime(`${from}T00:00:00`, tz);
  // Exclusive end: local midnight starting the day after `to` (calendar math, so DST days work).
  const dayAfter = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const toUtc = fromZonedTime(`${dayAfter}T00:00:00`, tz);
  const maxSpan = 3 * 366 * 86_400_000;
  if (toUtc.getTime() - fromUtc.getTime() > maxSpan) {
    const capped = new Date(toUtc.getTime() - maxSpan);
    from = formatInTimeZone(capped, tz, "yyyy-MM-dd");
    return { from, to, fromUtc: fromZonedTime(`${from}T00:00:00`, tz), toUtc };
  }
  return { from, to, fromUtc, toUtc };
}

/** Turn report rows into display lines (biggest earners first, unassigned last). */
export function commissionLines(rows: CoachRevenueRow[], names: Map<string, string>): CommissionLine[] {
  const totalNet = rows.reduce((s, r) => s + (r.net_cents ?? 0), 0);
  return rows
    .map((r) => {
      const net = r.net_cents ?? 0;
      const fee = r.platform_fee_cents ?? 0;
      return {
        coachId: r.coach_id,
        coachName: r.coach_id ? (names.get(r.coach_id) ?? "Former coach") : "Unassigned",
        payments: r.payments ?? 0,
        grossCents: r.gross_cents ?? 0,
        refundedCents: r.refunded_cents ?? 0,
        netCents: net,
        platformFeeCents: fee,
        keptCents: net - fee,
        share: totalNet > 0 ? net / totalNet : 0,
      };
    })
    .sort((a, b) => (a.coachId === null ? 1 : b.coachId === null ? -1 : b.netCents - a.netCents || a.coachName.localeCompare(b.coachName)));
}

export function commissionTotals(lines: CommissionLine[]) {
  return lines.reduce(
    (t, l) => ({
      payments: t.payments + l.payments,
      grossCents: t.grossCents + l.grossCents,
      refundedCents: t.refundedCents + l.refundedCents,
      netCents: t.netCents + l.netCents,
      platformFeeCents: t.platformFeeCents + l.platformFeeCents,
      keptCents: t.keptCents + l.keptCents,
    }),
    { payments: 0, grossCents: 0, refundedCents: 0, netCents: 0, platformFeeCents: 0, keptCents: 0 },
  );
}

/** RFC 4180 field; neutralises spreadsheet formulas. */
export function csvField(v: string | number): string {
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export function commissionCsv(lines: CommissionLine[], range: Pick<DateRange, "from" | "to">, currency = "usd"): string {
  const header = ["Coach", "From", "To", "Currency", "Payments", "Gross", "Refunded", "Net", "Platform fees", "Net after fees", "Share %"];
  const rows = lines.map((l) => [
    l.coachName, range.from, range.to, currency.toUpperCase(), l.payments,
    dollars(l.grossCents), dollars(l.refundedCents), dollars(l.netCents), dollars(l.platformFeeCents), dollars(l.keptCents),
    (l.share * 100).toFixed(1),
  ]);
  const t = commissionTotals(lines);
  rows.push([
    "Total", range.from, range.to, currency.toUpperCase(), t.payments,
    dollars(t.grossCents), dollars(t.refundedCents), dollars(t.netCents), dollars(t.platformFeeCents), dollars(t.keptCents),
    t.netCents > 0 ? "100.0" : "0.0",
  ]);
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
