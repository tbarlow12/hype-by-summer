"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/env";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";

const safeNext = (next: unknown) =>
  typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/auth/continue";

const loginSchema = z.object({
  email: z.email(),
  password: zfd.text(),
  next: zfd.text(),
  mode: z.enum(["password", "magic"]).default("password"),
});

export async function login(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(loginSchema, formData);
  if (parsed.error) return parsed.error;
  const { email, password, next, mode } = parsed.data;
  const supabase = await createClient();

  if (mode === "magic" || !password) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent(safeNext(next))}`),
        shouldCreateUser: true,
      },
    });
    if (error) return fail(error.message);
    return ok("Check your email for a sign-in link.");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail("That email and password don't match.");
  redirect(safeNext(next));
}

const signupSchema = z.object({
  full_name: zfd.requiredText("Please enter your name"),
  email: z.email(),
  password: z.string().min(8, "Use at least 8 characters"),
  phone: zfd.text(),
  next: zfd.text(),
});

export async function signup(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(signupSchema, formData);
  if (parsed.error) return parsed.error;
  const { full_name, email, password, phone, next } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name, phone },
      emailRedirectTo: absoluteUrl(`/auth/callback?next=${encodeURIComponent(safeNext(next))}`),
    },
  });
  if (error) return fail(error.message);
  if (!data.session) return ok("Almost there! Confirm your email to finish creating your account.");
  redirect(safeNext(next));
}
