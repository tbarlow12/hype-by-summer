"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";

const schema = z
  .object({ password: z.string().min(8, "Use at least 8 characters"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

/** Set or change the signed-in user's password (invited clients start without one). */
export async function setPassword(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(error.message);
  return ok("Password saved. You can use it next time you sign in.");
}
