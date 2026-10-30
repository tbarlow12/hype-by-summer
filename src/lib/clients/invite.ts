import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandOf, businessUrl, type Business } from "@/lib/tenant";
import { sendEmail } from "@/lib/email";
import { confirmUrl } from "@/lib/auth-emails";

// Branded invitations for staff-initiated adds (clients, team members).
// Supabase's own invite emails carry the platform's branding, so we make sure
// the auth user exists (created confirmed, no password), mint a one-time
// sign-in token with generateLink and email a link to the BUSINESS's own site
// (/auth/confirm verifies it there, so the session cookie lands on that host)
// with the business as the sender. Same link format as lib/auth-emails.ts;
// unlike its sendInvite, the account exists before the email is sent, so the
// caller can link the person first and the email can be retried.

type Address = Pick<Business, "slug" | "custom_domain" | "domain_verified_at">;

/**
 * The auth user for `email`, created (already confirmed, no password) when
 * missing. The handle_new_user trigger creates their profile.
 */
export async function ensureAuthUser(
  email: string,
  fullName?: string | null,
): Promise<{ userId: string; created: boolean } | { error: string }> {
  const admin = createAdminClient();
  const normalized = email.trim().toLowerCase();
  const { data: existing } = await admin.from("profiles").select("id").eq("email", normalized).maybeSingle();
  if (existing) return { userId: existing.id, created: false };

  const { data, error } = await admin.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });
  if (data?.user) return { userId: data.user.id, created: true };
  // Auth user exists without a profile row (rare): generateLink resolves it.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: normalized });
  if (link?.user) return { userId: link.user.id, created: false };
  return { error: error?.message ?? linkErr?.message ?? "Could not create the account." };
}

/**
 * One-time sign-in URL on the business's site that lands on `next`
 * (default /me). Valid for the Supabase OTP lifetime (1 hour by default).
 */
export async function signInLink(business: Address, email: string, next = "/me"): Promise<{ url: string } | { error: string }> {
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: email.trim().toLowerCase(),
  });
  const token = data?.properties?.hashed_token;
  if (error || !token) return { error: error?.message ?? "Could not create a sign-in link." };
  return { url: confirmUrl(businessUrl(business), token, "magiclink", next) };
}

export type InviteEmail = {
  business: Business;
  email: string;
  fullName?: string | null;
  /** App-relative landing page after sign-in: "/me" for clients, "/coach" for staff. */
  next?: string;
  subject?: string;
  heading?: string;
  paragraphs?: string[];
  ctaLabel?: string;
};

export type InviteResult =
  | { ok: true; userId: string; created: boolean; emailed: boolean }
  | { ok: false; error: string };

/**
 * Make sure `email` has an account and send them a branded email with a
 * one-click sign-in link to the business's site. Does NOT create any
 * membership/client row: callers do that (after authorizing) with the
 * returned userId.
 */
export async function sendSignInInvite(input: InviteEmail): Promise<InviteResult> {
  const { business } = input;
  const user = await ensureAuthUser(input.email, input.fullName);
  if ("error" in user) return { ok: false, error: user.error };
  const link = await signInLink(business, input.email, input.next ?? "/me");
  if ("error" in link) return { ok: false, error: link.error };

  const brand = brandOf(business);
  const first = input.fullName?.trim().split(/\s+/)[0];
  const sent = await sendEmail({
    brand,
    to: input.email,
    subject: input.subject ?? `You're invited to ${brand.name}`,
    heading: input.heading ?? (first ? `Welcome, ${first}!` : `Welcome to ${brand.name}`),
    paragraphs: input.paragraphs ?? [
      `${brand.name} set up your account so you can book sessions, follow your training plan and message your coach in one place.`,
      "Tap the button below to sign in. No password needed; you can set one later in your profile.",
    ],
    cta: { label: input.ctaLabel ?? "Sign in", url: link.url },
    footerNote: `This link works once and expires soon. Afterwards, sign in any time at ${businessUrl(business, "/login")}.`,
  });
  return { ok: true, userId: user.userId, created: user.created, emailed: sent.ok };
}
