import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { brandOf, businessUrl, getBusiness, siteUrl, type Business } from "@/lib/tenant";

// Branded auth emails. Supabase's own templates are never used: we ask the
// admin API for a hashed token (auth.admin.generateLink) and email a link to
// /auth/confirm on the business's site (or the platform's), sent with the
// business's name and colors. The link verifies with verifyOtp there, so the
// session cookie lands on the right host.

export type ConfirmType = "magiclink" | "signup" | "invite" | "recovery" | "email";

/** A same-site relative path, or the post-login router. */
export function safeNext(next: unknown, fallback = "/auth/continue"): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : fallback;
}

/** `${base}/auth/confirm?token_hash=…&type=…&next=…` */
export function confirmUrl(base: string, tokenHash: string, type: ConfirmType, next?: string): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type, next: safeNext(next) });
  return `${base.replace(/\/+$/, "")}/auth/confirm?${params.toString()}`;
}

/**
 * Which site the link lands on and whose brand the email wears. Explicit
 * `business` (no request host, e.g. an invite sent from a job) uses its
 * canonical URL; otherwise the current host (business or platform).
 */
type Target = { business?: Business | null };

async function resolveTarget(target?: Target) {
  if (target && "business" in target) {
    const business = target.business ?? null;
    const brand = brandOf(business);
    return { brand, base: business ? businessUrl(business) : brand.siteUrl };
  }
  const business = await getBusiness();
  return { brand: brandOf(business), base: await siteUrl("/") };
}

// Cheap per-instance throttle so a form can't be used to flood an inbox.
const recent = new Map<string, number>();
function throttled(key: string, ms = 45_000): boolean {
  const now = Date.now();
  if (recent.size > 5_000) recent.clear();
  const last = recent.get(key);
  if (last && now - last < ms) return true;
  recent.set(key, now);
  return false;
}

const normalize = (email: string) => email.trim().toLowerCase();

async function accountExists(email: string): Promise<boolean> {
  const { data } = await createAdminClient().from("profiles").select("id").eq("email", email).maybeSingle();
  return Boolean(data);
}

const IGNORE = "If you didn't ask for this, you can ignore this email.";

/**
 * Email a one-click sign-in link. Creates the account if there isn't one
 * (an invite-type link, which works the same way). Never reveals whether the
 * email was registered.
 */
export async function sendMagicLink(email: string, next?: string, target?: Target): Promise<{ ok: boolean }> {
  email = normalize(email);
  if (throttled(`magic:${email}`)) return { ok: true };
  const { brand, base } = await resolveTarget(target);
  const admin = createAdminClient();
  const exists = await accountExists(email);
  const { data, error } = exists
    ? await admin.auth.admin.generateLink({ type: "magiclink", email })
    : await admin.auth.admin.generateLink({ type: "invite", email });
  if (error || !data.properties?.hashed_token) {
    console.error("[auth-emails] magic link failed", error?.message);
    return { ok: false };
  }
  const url = confirmUrl(base, data.properties.hashed_token, exists ? "magiclink" : "invite", next);
  const sent = await sendEmail({
    brand,
    to: email,
    subject: `Your sign-in link for ${brand.name}`,
    heading: "Sign in",
    paragraphs: [`Tap the button below to sign in to ${brand.name}. The link works once and expires in an hour.`],
    cta: { label: "Sign in", url },
    footerNote: IGNORE,
  });
  return { ok: sent.ok };
}

export type SignupInput = {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  next?: string;
};

/**
 * Create an account (unconfirmed) and email a branded confirmation link. If
 * the email already has an account anywhere on the platform, send a sign-in
 * link instead: the caller shows the same "check your email" either way, so
 * signup can't be used to discover who has an account.
 */
export async function sendSignupConfirmation(input: SignupInput, target?: Target): Promise<{ ok: boolean }> {
  const email = normalize(input.email);
  if (await accountExists(email)) return sendMagicLink(email, input.next, target);
  if (throttled(`signup:${email}`)) return { ok: true };
  const { brand, base } = await resolveTarget(target);
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "signup",
    email,
    password: input.password,
    options: { data: { full_name: input.fullName, phone: input.phone ?? null } },
  });
  if (error || !data.properties?.hashed_token) {
    // Raced with another signup, or the user exists without a profile yet.
    if (error && /already|exists|registered/i.test(error.message)) return sendMagicLink(email, input.next, target);
    console.error("[auth-emails] signup link failed", error?.message);
    return { ok: false };
  }
  const url = confirmUrl(base, data.properties.hashed_token, "signup", input.next);
  const first = input.fullName.split(/\s+/)[0] || "there";
  const sent = await sendEmail({
    brand,
    to: email,
    subject: `Confirm your ${brand.name} account`,
    heading: `Welcome, ${first}!`,
    paragraphs: [`Confirm your email to finish creating your ${brand.name} account.`],
    cta: { label: "Confirm my email", url },
    footerNote: IGNORE,
  });
  return { ok: sent.ok };
}

/** Where a recovery link sends people to choose a new password. */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Email a password-reset link. Silently does nothing for unknown emails. */
export async function sendPasswordReset(email: string, target?: Target): Promise<{ ok: boolean }> {
  email = normalize(email);
  if (throttled(`recovery:${email}`)) return { ok: true };
  if (!(await accountExists(email))) return { ok: true };
  const { brand, base } = await resolveTarget(target);
  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
  if (error || !data.properties?.hashed_token) {
    console.error("[auth-emails] recovery link failed", error?.message);
    return { ok: false };
  }
  const url = confirmUrl(base, data.properties.hashed_token, "recovery", RESET_PASSWORD_PATH);
  const sent = await sendEmail({
    brand,
    to: email,
    subject: `Reset your ${brand.name} password`,
    heading: "Reset your password",
    paragraphs: ["Tap the button below to choose a new password. The link works once and expires in an hour."],
    cta: { label: "Choose a new password", url },
    footerNote: `If you didn't ask to reset your password, you can ignore this email; your password hasn't changed.`,
  });
  return { ok: sent.ok };
}

/**
 * Invite someone (client or team member) to a business: creates the account
 * if needed and emails a branded link that signs them in at `next`. Returns
 * their user id so the caller can link them (business_clients / members).
 */
export async function sendInvite(
  email: string,
  opts: { business: Business; next?: string; fullName?: string | null; heading?: string; message?: string },
): Promise<{ ok: boolean; userId?: string }> {
  email = normalize(email);
  const brand = brandOf(opts.business);
  const admin = createAdminClient();
  const exists = await accountExists(email);
  const { data, error } = exists
    ? await admin.auth.admin.generateLink({ type: "magiclink", email })
    : await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: opts.fullName ? { data: { full_name: opts.fullName } } : undefined,
      });
  if (error || !data.properties?.hashed_token) {
    console.error("[auth-emails] invite failed", error?.message);
    return { ok: false };
  }
  const url = confirmUrl(businessUrl(opts.business), data.properties.hashed_token, exists ? "magiclink" : "invite", opts.next);
  const sent = await sendEmail({
    brand,
    to: email,
    subject: `You're invited to ${brand.name}`,
    heading: opts.heading ?? `Join ${brand.name}`,
    paragraphs: [opts.message ?? `${brand.name} invited you. Tap below to get started; no password needed.`],
    cta: { label: "Accept invite", url },
    footerNote: "The link works once. If it has expired, use \"Email me a sign-in link\" on the sign-in page.",
  });
  return { ok: sent.ok, userId: data.user?.id };
}
