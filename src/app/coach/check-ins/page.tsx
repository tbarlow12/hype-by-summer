import Link from "next/link";
import { Avatar, Card, CardTitle, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { CheckInCard } from "@/components/training/check-in-card";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { respondToCheckIn } from "@/lib/training/coach-actions";
import { longDateLabel, todayInTz, weekStartMonday } from "@/lib/training/dates";
import { inboxScope } from "@/lib/training/routing";

export const metadata = { title: "Check-ins" };

const CLIENT_EMBED = "client:profiles!check_ins_client_id_fkey(id, full_name, email, avatar_url)";
const RESPONDER_EMBED = "responder:profiles!check_ins_responded_by_fkey(full_name)";

export default async function CoachCheckInsPage({ searchParams }: PageProps<"/coach/check-ins">) {
  const { profile, business, membership } = await requireStaff();
  const sp = await searchParams;
  // Coaches default to their own clients (primary coach = me); managers to everyone.
  const scope = inboxScope(sp.scope, isManager(membership));
  const supabase = await createClient();
  // Clients check in by their own Monday; the coach's Monday is close enough for the roll call.
  const weekOf = weekStartMonday(todayInTz(profile.timezone));

  const { data: activeRoster } = await supabase
    .from("business_clients")
    .select("client_id, primary_coach_id, client:profiles!business_clients_client_id_fkey(id, full_name, email, avatar_url)")
    .eq("business_id", business.id)
    .eq("status", "active");
  const roster = (activeRoster ?? []).filter((r) => scope === "all" || r.primary_coach_id === profile.id);
  const myClientIds = roster.map((r) => r.client_id);

  // "Mine" filters every query to my clients.
  const ids = scope === "all" ? null : myClientIds;
  let inboxQ = supabase
    .from("check_ins")
    .select(`*, ${CLIENT_EMBED}, ${RESPONDER_EMBED}`)
    .eq("business_id", business.id)
    .is("coach_response", null);
  let recentQ = supabase
    .from("check_ins")
    .select(`*, ${CLIENT_EMBED}, ${RESPONDER_EMBED}`)
    .eq("business_id", business.id)
    .not("coach_response", "is", null);
  let weekQ = supabase.from("check_ins").select("client_id").eq("business_id", business.id).gte("week_of", weekOf);
  if (ids) {
    inboxQ = inboxQ.in("client_id", ids);
    recentQ = recentQ.in("client_id", ids);
    weekQ = weekQ.in("client_id", ids);
  }
  const [{ data: inbox }, { data: recent }, { data: thisWeek }] = await Promise.all([
    inboxQ.order("created_at", { ascending: true }).limit(50),
    recentQ.order("coach_responded_at", { ascending: false }).limit(10),
    weekQ,
  ]);

  const checkedIn = new Set((thisWeek ?? []).map((c) => c.client_id));
  const missing = roster
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
      <PageHeader
        title="Check-ins"
        description={`Weekly check-ins from ${scope === "mine" ? "your clients" : "all clients"}. This week started ${longDateLabel(weekOf, { weekday: "long", month: "short", day: "numeric" })}.`}
        actions={
          <div className="flex gap-1" role="group" aria-label="Whose check-ins">
            <LinkButton href="/coach/check-ins?scope=mine" size="sm" variant={scope === "mine" ? "primary" : "ghost"} aria-current={scope === "mine" ? "page" : undefined}>
              My clients
            </LinkButton>
            <LinkButton href="/coach/check-ins?scope=all" size="sm" variant={scope === "all" ? "primary" : "ghost"} aria-current={scope === "all" ? "page" : undefined}>
              All clients
            </LinkButton>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Needs a reply" value={inbox?.length ?? 0} />
        <Stat label="Checked in this week" value={`${roster.length - missing.length}/${roster.length}`} />
        <Stat label="Missing this week" value={missing.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="inbox-h">
          <h2 id="inbox-h" className="mb-3 text-lg font-semibold">Needs a reply</h2>
          {!inbox?.length ? (
            <EmptyState
              title="Inbox zero"
              description={
                scope === "mine" && myClientIds.length === 0
                  ? "You aren't the primary coach for any active clients. Switch to All clients to see the whole team's."
                  : "Every check-in has a reply. New ones show up here."
              }
            />
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
              <p className="mt-2 text-sm text-zinc-500">{roster.length ? "Everyone's checked in." : "No active clients yet."}</p>
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
