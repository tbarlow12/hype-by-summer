import { describe, expect, it } from "vitest";
import { checkEnv } from "./env-check";

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  NEXT_PUBLIC_SITE_URL: "https://hype.example",
  OWNER_EMAIL: "coach@example.com",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  RESEND_API_KEY: "re_x",
  TWILIO_ACCOUNT_SID: "AC1",
  CRON_SECRET: "c",
};

describe("checkEnv", () => {
  it("is clean when everything is set", () => {
    expect(checkEnv(complete)).toEqual([]);
  });
  it("names the missing secret key", () => {
    const errs = checkEnv({ ...complete, SUPABASE_SECRET_KEY: undefined }).filter((p) => p.level === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toMatch(/^SUPABASE_SECRET_KEY is missing/);
  });
  it("accepts legacy key names", () => {
    const env = { ...complete, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: "eyJ...", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ..." };
    expect(checkEnv(env)).toEqual([]);
  });
  it("catches the publishable key pasted as the secret", () => {
    expect(checkEnv({ ...complete, SUPABASE_SECRET_KEY: "sb_publishable_x" })[0]!.message).toMatch(/publishable key/);
  });
  it("requires the webhook secret once Stripe is on, and warns for optional features", () => {
    const p = checkEnv({ ...complete, STRIPE_WEBHOOK_SECRET: "", RESEND_API_KEY: undefined });
    expect(p.find((x) => x.level === "error")!.message).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(p.find((x) => x.level === "warning")!.message).toMatch(/RESEND_API_KEY/);
  });
  it("accepts Vercel's production URL in place of NEXT_PUBLIC_SITE_URL", () => {
    expect(checkEnv({ ...complete, NEXT_PUBLIC_SITE_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: "hype.vercel.app" })).toEqual([]);
  });
});
