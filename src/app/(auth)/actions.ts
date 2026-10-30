"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { safeNext, sendMagicLink, sendPasswordReset, sendSignupConfirmation } from "@/lib/auth-emails";

// Auth on any site (a business's or the platform's). Emails are ours and
// branded (lib/auth-emails.ts); messages never reveal whether an email has
// an account.

const CHECK_EMAIL = "Check your email for a link to continue.";

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: zfd.text(),
  next: zfd.text(),
  mode: z.enum(["password", "magic"]).default("password"),
});

export async function login(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(loginSchema, formData);
  if (parsed.error) return parsed.error;
  const { email, password, next, mode } = parsed.data;

  if (mode === "magic" || !password) {
    const sent = await sendMagicLink(email, safeNext(next));
    if (!sent.ok) return fail("We couldn't send the email just now. Please try again in a minute.");
    return ok("Check your email for a sign-in link.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/confirm/i.test(error.message)) return fail("Please confirm your email first; we sent you a link when you signed up.");
    return fail("That email and password don't match.");
  }
  redirect(safeNext(next));
}

const signupSchema = z.object({
  full_name: zfd.requiredText("Please enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
  phone: zfd.text(),
  next: zfd.text(),
});

export async function signup(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(signupSchema, formData);
  if (parsed.error) return parsed.error;
  const { full_name, email, password, phone, next } = parsed.data;
  const sent = await sendSignupConfirmation({ email, password, fullName: full_name, phone, next: safeNext(next) });
  if (!sent.ok) return fail("We couldn't send the email just now. Please try again in a minute.");
  // Same message whether or not the email already had an account.
  return ok(CHECK_EMAIL, { sent: true });
}

const forgotSchema = z.object({ email: z.email("Enter a valid email") });

export async function forgotPassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(forgotSchema, formData);
  if (parsed.error) return parsed.error;
  await sendPasswordReset(parsed.data.email);
  return ok("If that email has an account, we've sent a link to reset the password.", { sent: true });
}
