import { describe, expect, it } from "vitest";
import { checkEnv } from "./env-check";

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  NEXT_PUBLIC_PLATFORM_DOMAIN: "trainer-os.com",
  NEXT_PUBLIC_PLATFORM_NAME: "TrainerOS",
  PLATFORM_ADMIN_EMAILS: "ops@example.com",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_y",
  RESEND_API_KEY: "re_x",
  EMAIL_FROM_ADDRESS: "hello@trainer-os.com",
  VERCEL_TOKEN: "v",
  VERCEL_PROJECT_ID: "prj_1",
  TWILIO_ACCOUNT_SID: "AC1",
  CRON_SECRET: "c",
};

const errors = (env: Record<string, string | undefined>) => checkEnv(env).filter((p) => p.level === "error");
const warnings = (env: Record<string, string | undefined>) => checkEnv(env).filter((p) => p.level === "warning");

describe("checkEnv", () => {
  it("is clean when everything is set", () => {
    expect(checkEnv(complete)).toEqual([]);
  });
  it("no longer needs OWNER_EMAIL or NEXT_PUBLIC_SITE_URL", () => {
    expect(checkEnv({ ...complete, OWNER_EMAIL: undefined, NEXT_PUBLIC_SITE_URL: undefined })).toEqual([]);
  });
  it("names the missing secret key", () => {
    const errs = errors({ ...complete, SUPABASE_SECRET_KEY: undefined });
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
  it("requires the platform domain unless a default tenant is set, and checks its shape", () => {
    expect(errors({ ...complete, NEXT_PUBLIC_PLATFORM_DOMAIN: undefined })[0]!.message).toMatch(/NEXT_PUBLIC_PLATFORM_DOMAIN is missing/);
    expect(errors({ ...complete, NEXT_PUBLIC_PLATFORM_DOMAIN: undefined, NEXT_PUBLIC_DEFAULT_TENANT_SLUG: "summer" })).toEqual([]);
    expect(errors({ ...complete, NEXT_PUBLIC_PLATFORM_DOMAIN: "https://trainer-os.com" })[0]!.message).toMatch(/bare host/);
    expect(errors({ ...complete, NEXT_PUBLIC_PLATFORM_DOMAIN: "localhost:3000" })).toEqual([]);
  });
  it("validates plan pricing overrides", () => {
    expect(errors({ ...complete, PLATFORM_STARTER_FEE_BPS: "3%" })[0]!.message).toMatch(/PLATFORM_STARTER_FEE_BPS/);
    expect(errors({ ...complete, PLATFORM_PRO_PRICE_DOLLARS: "$49" })[0]!.message).toMatch(/PLATFORM_PRO_PRICE_DOLLARS/);
    expect(checkEnv({ ...complete, PLATFORM_STARTER_FEE_BPS: "250", PLATFORM_PRO_PRICE_DOLLARS: "49.99" })).toEqual([]);
  });
  it("requires both webhook secrets once Stripe is on", () => {
    expect(errors({ ...complete, STRIPE_WEBHOOK_SECRET: "" })[0]!.message).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(errors({ ...complete, STRIPE_CONNECT_WEBHOOK_SECRET: undefined })[0]!.message).toMatch(/STRIPE_CONNECT_WEBHOOK_SECRET/);
    expect(errors({ ...complete, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, STRIPE_CONNECT_WEBHOOK_SECRET: undefined })).toEqual([]);
  });
  it("needs a from address once Resend is on, and warns for optional features", () => {
    expect(errors({ ...complete, EMAIL_FROM_ADDRESS: undefined })[0]!.message).toMatch(/EMAIL_FROM_ADDRESS/);
    const w = warnings({ ...complete, RESEND_API_KEY: undefined, VERCEL_TOKEN: undefined, PLATFORM_ADMIN_EMAILS: undefined });
    expect(w.map((x) => x.message.split(" ")[0])).toEqual(["PLATFORM_ADMIN_EMAILS", "RESEND_API_KEY", "VERCEL_TOKEN"]);
  });
});
