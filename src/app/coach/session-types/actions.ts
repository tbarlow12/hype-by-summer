"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";

const schema = z
  .object({
    name: zfd.requiredText("Name is required"),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,60}$/, "Lowercase letters, numbers and dashes"),
    description: zfd.text(),
    duration_minutes: z.coerce.number().int().min(5).max(600),
    price: zfd.cents(),
    location_type: z.enum(["in_person", "virtual", "phone", "client_location"]),
    location_details: zfd.text(),
    capacity: z.coerce.number().int().min(1).max(500),
    buffer_before_minutes: z.coerce.number().int().min(0).max(240),
    buffer_after_minutes: z.coerce.number().int().min(0).max(240),
    min_notice_hours: z.coerce.number().min(0).max(24 * 60),
    max_advance_days: z.coerce.number().int().min(1).max(730),
    slot_interval_minutes: z.coerce.number().int().min(5).max(240),
    credits_required: z.coerce.number().int().min(0).max(50),
    allow_credits: zfd.checkbox(),
    requires_payment: zfd.checkbox(),
    is_consultation: zfd.checkbox(),
    clients_only: zfd.checkbox(),
    active: zfd.checkbox(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color"),
    sort_order: z.coerce.number().int().min(-1000).max(1000),
  })
  .transform(({ price, min_notice_hours, ...rest }) => ({
    ...rest,
    price_cents: rest.is_consultation ? 0 : price,
    min_notice_minutes: Math.round(min_notice_hours * 60),
    description: rest.description ?? null,
    location_details: rest.location_details ?? null,
    requires_payment: rest.is_consultation ? false : rest.requires_payment,
  }));

function saveError(error: { code?: string; message: string }) {
  return fail(error.code === "23505" ? "You already have a session type with that link." : error.message);
}

export async function createSessionTypeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.from("session_types").insert({ ...parsed.data, trainer_id: profile.id });
  if (error) return saveError(error);
  revalidatePath("/coach/session-types");
  redirect("/coach/session-types");
}

export async function updateSessionTypeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("Missing session type.");
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("session_types")
    .update(parsed.data)
    .eq("id", id.data)
    .eq("trainer_id", profile.id)
    .select("id")
    .maybeSingle();
  if (error) return saveError(error);
  if (!data) return fail("Session type not found.");
  revalidatePath("/coach/session-types");
  return ok("Saved.");
}

export async function toggleSessionTypeAction(formData: FormData): Promise<void> {
  const profile = await requireTrainer();
  const id = z.uuid().parse(formData.get("id"));
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  await supabase.from("session_types").update({ active }).eq("id", id).eq("trainer_id", profile.id);
  revalidatePath("/coach/session-types");
}

/** Swap sort order with the neighbour above/below. */
export async function moveSessionTypeAction(formData: FormData): Promise<void> {
  const profile = await requireTrainer();
  const id = z.uuid().parse(formData.get("id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;
  const supabase = await createClient();
  const { data: types } = await supabase
    .from("session_types")
    .select("id, sort_order")
    .eq("trainer_id", profile.id)
    .order("sort_order")
    .order("name");
  if (!types) return;
  const index = types.findIndex((t) => t.id === id);
  const other = types[index + dir];
  if (index < 0 || !other) return;
  // Normalise to 0..n then swap, so equal sort orders still move.
  const ordered = types.map((t) => t.id);
  [ordered[index], ordered[index + dir]] = [ordered[index + dir]!, ordered[index]!];
  await Promise.all(ordered.map((tid, i) => supabase.from("session_types").update({ sort_order: i }).eq("id", tid).eq("trainer_id", profile.id)));
  revalidatePath("/coach/session-types");
}

export async function deleteSessionTypeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireTrainer();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return fail("Missing session type.");
  const supabase = await createClient();
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true }).eq("session_type_id", id.data);
  if (count) return fail("This session type has bookings, so it can't be deleted. Turn it off instead to hide it.");
  const { error } = await supabase.from("session_types").delete().eq("id", id.data).eq("trainer_id", profile.id);
  if (error) return fail(error.message);
  revalidatePath("/coach/session-types");
  redirect("/coach/session-types");
}
