// The platform's two plans. Every feature is on both; the plan only changes
// how the platform gets paid. Pure (env passed in) so it's unit-testable.

export type PlanPricing = {
  /** Starter: platform fee on each client payment, in basis points (300 = 3%). */
  starterFeeBps: number;
  /** Pro: flat monthly price in cents, no platform fee. */
  proMonthlyCents: number;
};

type Env = Record<string, string | undefined>;

export function planPricing(env: Env = process.env): PlanPricing {
  const bps = Number.parseInt(env.PLATFORM_STARTER_FEE_BPS ?? "", 10);
  const dollars = Number.parseFloat(env.PLATFORM_PRO_PRICE_DOLLARS ?? "");
  return {
    starterFeeBps: Number.isFinite(bps) && bps >= 0 && bps <= 3000 ? bps : 300,
    proMonthlyCents: Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : 4900,
  };
}

/** "3%", "2.5%" */
export function formatBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** "$49", "$49.50" */
export function formatDollars(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** What the platform costs per month on each plan for a given monthly volume of client payments. */
export function monthlyCost(volumeCents: number, p: PlanPricing): { starter: number; pro: number } {
  return { starter: Math.round((Math.max(0, volumeCents) * p.starterFeeBps) / 10_000), pro: p.proMonthlyCents };
}

/** Monthly client-payment volume above which Pro is cheaper (null if Starter is free). */
export function breakEvenCents(p: PlanPricing): number | null {
  if (p.starterFeeBps === 0) return null;
  return Math.ceil((p.proMonthlyCents * 10_000) / p.starterFeeBps);
}
