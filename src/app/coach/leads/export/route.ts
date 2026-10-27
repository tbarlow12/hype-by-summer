import { NextResponse, type NextRequest } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toCsv, type CsvColumn } from "@/lib/leads/csv";
import { parseLeadFilters } from "@/lib/leads/filters";
import type { Tables } from "@/lib/supabase/database.types";
import { fetchLeads } from "../query";

type Lead = Tables<"leads">;

// GET /coach/leads/export?…filters — CSV of the trainer's leads (RLS-scoped).
export async function GET(request: NextRequest) {
  const trainer = await requireTrainer();
  const filters = parseLeadFilters(request.nextUrl.searchParams);
  const [{ data, error }, { data: magnets }] = await Promise.all([
    fetchLeads(trainer.id, filters, trainer.timezone, { limit: 10000 }),
    (await createClient()).from("lead_magnets").select("id, title").eq("trainer_id", trainer.id),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const magnetTitle = new Map((magnets ?? []).map((m) => [m.id, m.title]));
  const tz = trainer.timezone;
  const when = (v: string | null) => (v ? formatInTimeZone(v, tz, "yyyy-MM-dd HH:mm") : "");

  const columns: CsvColumn<Lead>[] = [
    { header: "First name", value: (l) => l.first_name },
    { header: "Last name", value: (l) => l.last_name },
    { header: "Email", value: (l) => l.email },
    { header: "Phone", value: (l) => l.phone },
    { header: "Status", value: (l) => l.status },
    { header: "Score", value: (l) => l.score },
    { header: "Source", value: (l) => l.source },
    { header: "Lead magnet", value: (l) => (l.lead_magnet_id ? magnetTitle.get(l.lead_magnet_id) : "") },
    { header: "Primary goal", value: (l) => l.primary_goal },
    { header: "Goal details", value: (l) => l.goal_details },
    { header: "Experience", value: (l) => l.experience_level },
    { header: "Preferred format", value: (l) => l.preferred_format },
    { header: "Preferred days", value: (l) => l.preferred_days },
    { header: "Preferred times", value: (l) => l.preferred_times },
    { header: "Budget", value: (l) => l.budget_range },
    { header: "Timeline", value: (l) => l.timeline },
    { header: "City", value: (l) => l.city },
    { header: "ZIP", value: (l) => l.zip_code },
    { header: "Injuries / limitations", value: (l) => l.injuries_or_limitations },
    { header: "How heard", value: (l) => l.how_heard },
    { header: "UTM source", value: (l) => l.utm_source },
    { header: "UTM medium", value: (l) => l.utm_medium },
    { header: "UTM campaign", value: (l) => l.utm_campaign },
    { header: "UTM term", value: (l) => l.utm_term },
    { header: "UTM content", value: (l) => l.utm_content },
    { header: "Referrer", value: (l) => l.referrer_url },
    { header: "Landing page", value: (l) => l.landing_page },
    { header: "Last touch campaign", value: (l) => (l.last_touch as Record<string, string> | null)?.utm_campaign },
    { header: "Country", value: (l) => l.country },
    { header: "Marketing consent", value: (l) => (l.marketing_consent ? "yes" : "no") },
    { header: "Consented at", value: (l) => when(l.consented_at) },
    { header: "Unsubscribed at", value: (l) => when(l.unsubscribed_at) },
    { header: "Tags", value: (l) => l.tags },
    { header: "Next follow-up", value: (l) => when(l.next_follow_up_at) },
    { header: "Last contacted", value: (l) => when(l.last_contacted_at) },
    { header: "Lost reason", value: (l) => l.lost_reason },
    { header: "Converted at", value: (l) => when(l.converted_at) },
    { header: "First seen", value: (l) => when(l.first_seen_at) },
    { header: "Created", value: (l) => when(l.created_at) },
  ];

  const csv = toCsv(data ?? [], columns);
  const stamp = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
