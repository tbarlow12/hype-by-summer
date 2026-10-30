"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";

const schema = z.object({ business_id: z.uuid(), status: z.enum(["active", "suspended"]) });

/** Suspend (site 404s, nobody can sign in to it) or reactivate a business. */
export async function setBusinessStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const { business_id, status } = parsed.data;
  const { data, error } = await createAdminClient()
    .from("businesses")
    .update({ status })
    .eq("id", business_id)
    .select("name")
    .maybeSingle();
  if (error || !data) return fail("Couldn't update that business.");
  console.info(`[platform-admin] ${admin.email} set ${business_id} (${data.name}) to ${status}`);
  revalidatePath("/platform/admin");
  return ok(status === "suspended" ? `${data.name} is suspended.` : `${data.name} is active again.`);
}
