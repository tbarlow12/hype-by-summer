import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInvite } from "@/lib/auth-emails";
import type { Business } from "@/lib/tenant";

// Staff-initiated invitations (clients, team members). The branded email and
// sign-in link come from lib/auth-emails.ts (sendInvite: generateLink ->
// /auth/confirm on the business's own site). Callers authorize, then create
// the business_clients / business_members row with the returned user id.

/**
 * The auth user for `email`, created (confirmed, no password) when missing,
 * WITHOUT sending anything. For "add without emailing" flows; the
 * handle_new_user trigger creates their profile.
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
  return { error: error?.message ?? "Could not create the account." };
}

export type InviteEmail = {
  business: Business;
  email: string;
  fullName?: string | null;
  /** App-relative landing page after sign-in: "/me" for clients, "/coach" for staff. */
  next?: string;
  heading?: string;
  message?: string;
};

export type InviteResult = { ok: true; userId: string; emailed: boolean } | { ok: false; error: string };

/**
 * Email a branded one-click sign-in link to the business's site (creating the
 * account if needed). Does NOT create any membership/client row.
 */
export async function sendSignInInvite(input: InviteEmail): Promise<InviteResult> {
  const sent = await sendInvite(input.email, {
    business: input.business,
    next: input.next ?? "/me",
    fullName: input.fullName,
    heading: input.heading,
    message: input.message,
  });
  if (sent.userId) return { ok: true, userId: sent.userId, emailed: sent.ok };
  // Link generation failed; still resolve/create the account so the caller can link it.
  const user = await ensureAuthUser(input.email, input.fullName);
  if ("error" in user) return { ok: false, error: user.error };
  return { ok: true, userId: user.userId, emailed: false };
}
