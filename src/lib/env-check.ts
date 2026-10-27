// Startup configuration check. Pure so it can be unit tested; reported from
// src/instrumentation.ts when the server boots.

export type EnvProblem = { level: "error" | "warning"; message: string };
type Env = Record<string, string | undefined>;

const has = (env: Env, ...names: string[]) => names.some((n) => Boolean(env[n]?.trim()));

export function checkEnv(env: Env): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const error = (message: string) => problems.push({ level: "error", message });
  const warn = (message: string) => problems.push({ level: "warning", message });

  // Required: the site can't render without these.
  if (!has(env, "NEXT_PUBLIC_SUPABASE_URL")) {
    error("NEXT_PUBLIC_SUPABASE_URL is missing (Supabase → Project Settings → API).");
  } else if (!/^https?:\/\//.test(env.NEXT_PUBLIC_SUPABASE_URL!)) {
    error("NEXT_PUBLIC_SUPABASE_URL must be a full URL like https://<project>.supabase.co.");
  }
  if (!has(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing (Supabase → Project Settings → API Keys → publishable key).");
  }
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    error("SUPABASE_SECRET_KEY is missing (Supabase → Project Settings → API Keys → secret key). Every public page needs it.");
  } else if (secret.startsWith("sb_publishable_")) {
    error("SUPABASE_SECRET_KEY is set to the publishable key; use the secret key (sb_secret_…).");
  }
  if (!has(env, "NEXT_PUBLIC_SITE_URL")) {
    error("NEXT_PUBLIC_SITE_URL is missing (e.g. https://yourdomain.com). Email links and Stripe redirects use it.");
  }
  if (!has(env, "OWNER_EMAIL")) {
    error("OWNER_EMAIL is missing: no account can become the coach. Set it to the coach's sign-in email.");
  }

  // Optional features: warn so it's obvious what's off.
  if (!has(env, "STRIPE_SECRET_KEY")) warn("STRIPE_SECRET_KEY not set: card payments are disabled.");
  else if (!has(env, "STRIPE_WEBHOOK_SECRET")) error("STRIPE_WEBHOOK_SECRET is missing: paid bookings will never confirm.");
  if (!has(env, "RESEND_API_KEY")) warn("RESEND_API_KEY not set: emails are only logged, not sent.");
  if (!has(env, "TWILIO_ACCOUNT_SID")) warn("Twilio not configured: SMS reminders are only logged, not sent.");
  if (!has(env, "CRON_SECRET")) warn("CRON_SECRET not set: reminders and hold expiry (/api/cron/reminders) won't run.");
  return problems;
}

export function formatEnvReport(problems: EnvProblem[]): string {
  const errors = problems.filter((p) => p.level === "error");
  const warnings = problems.filter((p) => p.level === "warning");
  const lines: string[] = [];
  if (errors.length) {
    lines.push("Configuration errors (pages will fail until these are fixed):");
    for (const p of errors) lines.push(`  ✗ ${p.message}`);
  }
  if (warnings.length) {
    lines.push("Optional features not configured:");
    for (const p of warnings) lines.push(`  • ${p.message}`);
  }
  return lines.join("\n");
}
