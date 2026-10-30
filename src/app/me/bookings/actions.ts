"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, type ActionState } from "@/lib/actions";
import { cancelBooking } from "@/lib/scheduling/lifecycle";

export async function cancelMyBookingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireClient();
  const parsed = parseForm(z.object({ id: z.uuid(), reason: z.string().trim().max(500).optional() }), formData);
  if (parsed.error) return parsed.error;
  // RLS: clients can only read their own bookings.
  const supabase = await createClient();
  const { data } = await supabase.from("bookings").select("id").eq("id", parsed.data.id).eq("business_id", business.id).eq("client_id", profile.id).maybeSingle();
  if (!data) return fail("Booking not found.");
  const res = await cancelBooking({ bookingId: data.id, actor: { kind: "client", userId: profile.id }, reason: parsed.data.reason || undefined });
  if (!res.ok) return fail(res.error);
  revalidatePath("/me/bookings");
  return ok(res.message);
}
