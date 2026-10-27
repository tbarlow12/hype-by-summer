"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createVideoRoom } from "@/lib/video";

/** Trainer: create a video room for a booking that doesn't have one yet. */
export async function createRoomForBooking(input: { bookingId: string }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const profile = await getProfile();
  if (!profile || profile.role === "client") return { ok: false, error: "Only your coach can open the room." };
  const id = z.uuid().safeParse(input.bookingId);
  if (!id.success) return { ok: false, error: "Invalid session." };
  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, trainer_id, ends_at, video_room_url")
    .eq("id", id.data)
    .eq("trainer_id", profile.id)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Session not found." };
  if (booking.video_room_url) return { ok: true, url: booking.video_room_url };
  const url = await createVideoRoom({ bookingId: booking.id, endsAt: booking.ends_at });
  const { error } = await supabase.from("bookings").update({ video_room_url: url }).eq("id", booking.id).eq("trainer_id", profile.id);
  if (error) return { ok: false, error: "Couldn't save the room link." };
  revalidatePath(`/live/${booking.id}`);
  return { ok: true, url };
}
