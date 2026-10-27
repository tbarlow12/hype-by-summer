import Link from "next/link";
import { Avatar, Card, CardTitle, EmptyState, PageHeader, Stat } from "@/components/ui";
import { CheckInCard } from "@/components/training/check-in-card";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { respondToCheckIn } from "@/lib/training/coach-actions";
import { longDateLabel, todayInTz, weekStartMonday } from "@/lib/training/dates";

export const metadata = { title: "Check-ins" };

export default async function CoachCheckInsPage() {
  const profile = await requireTrainer();
  const supabase = await createClient();
  // Clients check in by their own Monday; the trainer's Monday is close enough for the roll call.
  const weekOf = weekStartMonday(todayInTz(profile.timezone));

  const [{ data: inbox }, { data: recent }, { data: roster }, { data: thisWeek }] = await Promise.all([
    supabase
      .from("check_ins")
      .select("*, client:profiles!check_ins_client_id_fkey(id, full_name, email, avatar_url)")
      .eq("trainer_id", profile.id)
      .is("trainer_response", null)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("check_ins")
      .select("*, client:profiles!check_ins_client_id_fkey(id, full_name, email, avatar_url)")
      .eq("trainer_id", profile.id)
      .not("trainer_response", "is", null)
      .order("trainer_responded_at", { ascending: false })
      .limit(10),
    supabase
      .from("trainer_clients")
      .select("client_id, client:profiles!trainer_clients_client_id_fkey(id, full_name, email, avatar_url)")
      .eq("trainer_id", profile.id)
      .eq("status", "active"),
    supabase.from("check_ins").select("client_id").eq("trainer_id", profile.id).gte("week_of", weekOf),
  ]);

  const checkedIn = new Set((thisWeek ?? []).map((c) => c.client_id));
  const missing = (roster ?? [])
    .filter((r) => !checkedIn.has(r.client_id))
    .sort((a, b) => displayName(a.client).localeCompare(displayName(b.client)));

  const heading = (c: { client: { id: string; full_name: string | null; email: string; avatar_url: string | null } | null }) => (
    <Link href={`/coach/clients/${c.client?.id}`} className="mb-1 flex items-center gap-2 text-sm font-semibold hover:text-brand">
      <Avatar name={displayName(c.client)} src={c.client?.avatar_url} size={24} />
      {displayName(c.client)}
    </Link>
  );

  return (
    <div>
      <PageHeader title="Check-ins" description={`Weekly check-ins from your clients. This week started ${longDateLabel(weekOf, { weekday: "long", month: "short", day: "numeric" })}.`} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Needs a reply" value={inbox?.length ?? 0} />
        <Stat label="Checked in this week" value={`${(roster ?? []).length - missing.length}/${(roster ?? []).length}`} />
        <Stat label="Missing this week" value={missing.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="inbox-h">
          <h2 id="inbox-h" className="mb-3 text-lg font-semibold">Needs a reply</h2>
          {!inbox?.length ? (
            <EmptyState title="Inbox zero" description="Every check-in has a reply. New ones show up here." />
          ) : (
            <div className="flex flex-col gap-3">
              {inbox.map((c) => (
                <CheckInCard key={c.id} checkIn={c} heading={heading(c)} respondAction={respondToCheckIn.bind(null, c.id)} defaultOpen />
              ))}
            </div>
          )}

          <h2 className="mb-3 mt-10 text-lg font-semibold">Recently answered</h2>
          {!recent?.length ? (
            <EmptyState title="No replies yet" description="Check-ins you've answered will appear here." />
          ) : (
            <div className="flex flex-col gap-3">
              {recent.map((c) => (
                <CheckInCard key={c.id} checkIn={c} heading={heading(c)} respondAction={respondToCheckIn.bind(null, c.id)} />
              ))}
            </div>
          )}
        </section>

        <aside aria-labelledby="missing-h">
          <Card>
            <CardTitle id="missing-h">Haven&apos;t checked in this week</CardTitle>
            {missing.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">{roster?.length ? "Everyone's checked in." : "No active clients yet."}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {missing.map((m) => (
                  <li key={m.client_id} className="flex items-center justify-between gap-2">
                    <Link href={`/coach/clients/${m.client_id}`} className="flex min-w-0 items-center gap-2 text-sm hover:text-brand">
                      <Avatar name={displayName(m.client)} src={m.client?.avatar_url} size={28} />
                      <span className="truncate">{displayName(m.client)}</span>
                    </Link>
                    <Link href={`/coach/messages/${m.client_id}`} className="shrink-0 text-xs font-medium text-brand hover:underline">
                      Nudge
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
