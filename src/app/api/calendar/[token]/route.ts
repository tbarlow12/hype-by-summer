import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessUrl, getBusinessById, type Business } from "@/lib/tenant";
import { tenantHost } from "@/lib/platform";
import { buildIcs, type IcsEvent } from "@/lib/scheduling/ics";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar/<business_members.calendar_feed_token>[.ics]: a coach's
 * private ICS subscription feed of their confirmed / completed sessions at
 * that business (last 60 days onward). The token identifies both the coach
 * and the business; calendar apps fetch it without a session.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token: raw } = await ctx.params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[a-f0-9]{16,64}$/.test(token)) return new Response("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("business_members")
    .select("business_id, user_id, active")
    .eq("calendar_feed_token", token)
    .maybeSingle();
  if (!member || !member.active) return new Response("Not found", { status: 404 });
  const business: Business | null = await getBusinessById(member.business_id);
  if (!business || business.status !== "active") return new Response("Not found", { status: 404 });

  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [{ data: bookings }, { data: types }] = await Promise.all([
    admin
      .from("bookings")
      .select(
        "id, session_type_id, starts_at, ends_at, status, guest_name, guest_email, client_id, client_notes, location_details, location_type, video_room_url, created_at, updated_at, profiles!bookings_client_id_fkey(full_name, email)",
      )
      .eq("business_id", business.id)
      .eq("coach_id", member.user_id)
      .in("status", ["confirmed", "completed"])
      .gte("starts_at", since)
      .order("starts_at")
      .limit(2000),
    admin.from("session_types").select("id, name, capacity").eq("business_id", business.id),
  ]);
  const typeById = new Map((types ?? []).map((t) => [t.id, t]));
  const host = tenantHost(business);

  // Group sessions (same type + start) become one event listing attendees.
  const groups = new Map<string, NonNullable<typeof bookings>>();
  for (const b of bookings ?? []) {
    const key = `${b.session_type_id}|${b.starts_at}`;
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }

  const events: IcsEvent[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const st = typeById.get(first.session_type_id);
    const names = list.map((b) => b.profiles?.full_name ?? b.guest_name ?? b.profiles?.email ?? b.guest_email ?? "Guest");
    const isGroup = (st?.capacity ?? 1) > 1;
    const summary = isGroup ? `${st?.name ?? "Session"} (${list.length}/${st?.capacity})` : `${st?.name ?? "Session"}: ${names[0]}`;
    const description = [
      isGroup ? `Attendees:\n${names.join("\n")}` : null,
      ...list.filter((b) => b.client_notes).map((b) => `Notes: ${b.client_notes}`),
      first.video_room_url ? `Video: ${first.video_room_url}` : null,
      ...list.map((b) => businessUrl(business, `/coach/calendar/${b.id}`)),
    ]
      .filter(Boolean)
      .join("\n\n");
    events.push({
      uid: isGroup ? `group-${first.session_type_id}-${member.user_id}-${Date.parse(first.starts_at)}@${host}` : `${first.id}@${host}`,
      start: first.starts_at,
      end: first.ends_at,
      summary,
      description,
      location: first.location_type === "virtual" ? (first.video_room_url ?? "Video call") : (first.location_details ?? business.default_location ?? undefined),
      created: first.created_at,
      lastModified: list.reduce((max, b) => (b.updated_at > max ? b.updated_at : max), first.updated_at),
    });
  }

  const body = buildIcs({
    events,
    name: `${business.name} sessions`,
    prodId: `-//${business.name.replace(/[/\r\n]/g, " ")}//Sessions//EN`,
    refreshMinutes: 30,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="sessions.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
