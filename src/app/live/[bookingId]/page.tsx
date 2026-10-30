import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { getMembership, isManager, requireUser } from "@/lib/auth";
import { requireBusiness } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDateTime } from "@/lib/format";
import { programDayFor } from "@/lib/comms/policy";
import { LiveRoom, type TodayWorkout } from "./live-room";

export const metadata = { title: "Live session" };

export default async function LivePage({ params }: PageProps<"/live/[bookingId]">) {
  const { bookingId } = await params;
  const business = await requireBusiness();
  const profile = await requireUser(`/live/${bookingId}`);
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) notFound();
  const membership = await getMembership();
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, business_id, coach_id, client_id, guest_name, starts_at, ends_at, status, location_type, video_room_url, session_types(name), client:profiles!bookings_client_id_fkey(full_name, email, timezone), coach:profiles!bookings_coach_id_fkey(full_name, email)",
    )
    .eq("id", bookingId)
    .eq("business_id", business.id)
    .maybeSingle();
  // RLS already limits rows; this is the explicit check: the session's coach,
  // a manager of the business, or the booked client.
  if (!booking) notFound();
  const isCoach = Boolean(membership) && booking.coach_id === profile.id;
  const isStaff = isCoach || isManager(membership);
  if (!isStaff && booking.client_id !== profile.id) notFound();

  const otherName = isStaff
    ? booking.client
      ? displayName(booking.client)
      : (booking.guest_name ?? "Guest")
    : booking.coach
      ? displayName(booking.coach)
      : business.name;

  let workout: TodayWorkout | null = null;
  if (isStaff && booking.client_id) {
    const clientTz = booking.client?.timezone ?? profile.timezone;
    const sessionDate = formatInTimeZone(booking.starts_at, clientTz, "yyyy-MM-dd");
    const { data: programs } = await supabase
      .from("programs")
      .select("id, name, start_date, duration_weeks")
      .eq("client_id", booking.client_id)
      .eq("business_id", business.id)
      .eq("status", "active")
      .not("start_date", "is", null)
      .order("start_date", { ascending: false });
    for (const p of programs ?? []) {
      const slot = programDayFor(p.start_date!, sessionDate, p.duration_weeks);
      if (!slot) continue;
      const { data: w } = await supabase
        .from("program_workouts")
        .select("id, name, notes, estimated_minutes, workout_exercises(id, sort_order, superset_group, sets, reps, load, rest_seconds, tempo, notes, exercises(name))")
        .eq("program_id", p.id)
        .eq("week", slot.week)
        .eq("day", slot.day)
        .order("sort_order")
        .limit(1)
        .maybeSingle();
      workout = w
        ? {
            program: p.name,
            week: slot.week,
            day: slot.day,
            name: w.name,
            notes: w.notes,
            minutes: w.estimated_minutes,
            exercises: [...(w.workout_exercises ?? [])]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((e) => ({
                id: e.id,
                name: e.exercises?.name ?? "Exercise",
                group: e.superset_group,
                prescription: [`${e.sets} × ${e.reps ?? "—"}`, e.load, e.tempo ? `tempo ${e.tempo}` : null, e.rest_seconds ? `rest ${e.rest_seconds}s` : null]
                  .filter(Boolean)
                  .join(" · "),
                notes: e.notes,
              })),
          }
        : { program: p.name, week: slot.week, day: slot.day, name: null, notes: null, minutes: null, exercises: [] };
      break;
    }
  }

  const cancelled = ["cancelled", "late_cancelled", "no_show"].includes(booking.status);

  return (
    <LiveRoom
      bookingId={booking.id}
      isStaff={isStaff}
      viewerName={displayName(profile)}
      title={`${booking.session_types?.name ?? "Session"} with ${otherName}`}
      when={formatDateTime(booking.starts_at, profile.timezone, "EEE, MMM d · h:mm a")}
      startsAt={booking.starts_at}
      endsAt={booking.ends_at}
      roomUrl={booking.video_room_url}
      cancelled={cancelled}
      isVirtual={booking.location_type === "virtual"}
      backHref={isStaff ? "/coach/calendar" : "/me/bookings"}
      chatHref={isStaff ? (booking.client_id ? `/coach/messages/${booking.client_id}` : null) : "/me/messages"}
      workout={isStaff && booking.client_id ? workout : undefined}
    />
  );
}
