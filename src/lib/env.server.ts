import "server-only";

function required(name: string, hint?: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}${hint ? ` (${hint})` : ""}`);
  return value;
}

export const serverEnv = {
  supabaseSecretKey: () =>
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    required("SUPABASE_SECRET_KEY", "Supabase → Project Settings → API Keys → secret key"),
  stripeSecretKey: () => required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => required("STRIPE_WEBHOOK_SECRET"),
  stripeAutomaticTax: () => process.env.STRIPE_AUTOMATIC_TAX === "true",
  resendApiKey: () => process.env.RESEND_API_KEY || null,
  /** Verified sending address; each email's display name is the business's. */
  emailFromAddress: () => {
    const raw = process.env.EMAIL_FROM_ADDRESS ?? process.env.EMAIL_FROM ?? "notifications@example.com";
    return raw.match(/<([^>]+)>/)?.[1] ?? raw.trim();
  },
  videoProvider: () => (process.env.VIDEO_PROVIDER === "daily" ? "daily" : "jitsi") as "daily" | "jitsi",
  dailyApiKey: () => process.env.DAILY_API_KEY || null,
  cronSecret: () => required("CRON_SECRET"),
};
