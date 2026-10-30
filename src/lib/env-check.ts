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
  // Platform routing: which host is the platform and which are businesses.
  const domain = env.NEXT_PUBLIC_PLATFORM_DOMAIN?.trim();
  if (!domain) {
    if (has(env, "NEXT_PUBLIC_DEFAULT_TENANT_SLUG")) {
      warn("NEXT_PUBLIC_PLATFORM_DOMAIN not set: serving only NEXT_PUBLIC_DEFAULT_TENANT_SLUG (single-business mode).");
    } else {
      error("NEXT_PUBLIC_PLATFORM_DOMAIN is missing (e.g. yourplatform.com, or localhost:3000 in development). Hosts are routed by it.");
    }
  } else if (/[/\s]|:\/\//.test(domain)) {
    error("NEXT_PUBLIC_PLATFORM_DOMAIN must be a bare host like yourplatform.com (no https://, no path).");
  }
  if (!has(env, "NEXT_PUBLIC_PLATFORM_NAME")) warn("NEXT_PUBLIC_PLATFORM_NAME not set: the platform's own site uses a placeholder name.");
  if (!has(env, "PLATFORM_ADMIN_EMAILS")) warn("PLATFORM_ADMIN_EMAILS not set: nobody can open the platform admin (/admin).");
  const bps = env.PLATFORM_STARTER_FEE_BPS?.trim();
  if (bps && !(/^\d+$/.test(bps) && Number(bps) <= 3000)) {
    error("PLATFORM_STARTER_FEE_BPS must be whole basis points from 0 to 3000 (300 = 3%).");
  }
  const pro = env.PLATFORM_PRO_PRICE_DOLLARS?.trim();
  if (pro && !(/^\d+(\.\d{1,2})?$/.test(pro))) error("PLATFORM_PRO_PRICE_DOLLARS must be a dollar amount like 49 or 49.99.");
  const proPrice = env.PLATFORM_PRO_PRICE_ID?.trim();
  if (proPrice && !proPrice.startsWith("price_")) error("PLATFORM_PRO_PRICE_ID must be a Stripe Price id (price_...) on the platform account.");

  // Email: sign-in, signup and password-reset emails are ours (not Supabase's).
  if (!has(env, "RESEND_API_KEY")) {
    warn("RESEND_API_KEY not set: emails (including sign-in links) are only logged to the console, not sent.");
  } else if (!has(env, "EMAIL_FROM_ADDRESS", "EMAIL_FROM")) {
    error("EMAIL_FROM_ADDRESS is missing: set it to an address on your Resend-verified domain, or no email (sign-in links included) is delivered.");
  }

  // Payments: the platform's Stripe account with Connect.
  if (!has(env, "STRIPE_SECRET_KEY")) {
    warn("STRIPE_SECRET_KEY not set: card payments, Stripe Connect and Pro subscriptions are disabled.");
  } else {
    if (!has(env, "STRIPE_WEBHOOK_SECRET")) error("STRIPE_WEBHOOK_SECRET is missing: platform webhooks (Pro subscriptions) will be rejected.");
    if (!has(env, "STRIPE_CONNECT_WEBHOOK_SECRET")) {
      error("STRIPE_CONNECT_WEBHOOK_SECRET is missing: payments on businesses' connected accounts will never confirm.");
    }
  }

  // Optional features: warn so it's obvious what's off.
  if (!has(env, "VERCEL_TOKEN") || !has(env, "VERCEL_PROJECT_ID")) {
    warn("VERCEL_TOKEN / VERCEL_PROJECT_ID not set: custom domains must be added to the Vercel project by hand.");
  }
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
