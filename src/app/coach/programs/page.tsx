import Link from "next/link";
import { Badge, Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { longDateLabel, programPosition, todayInTz } from "@/lib/training/dates";

export const metadata = { title: "Programs" };

const STATUS_TONE = { draft: "neutral", active: "green", completed: "blue", archived: "neutral" } as const;

export default async function ProgramsPage({ searchParams }: PageProps<"/coach/programs">) {
  const profile = await requireTrainer();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const supabase = await createClient();

  let query = supabase
    .from("programs")
    .select("id, name, goal, duration_weeks, status, start_date, client_id, template_id, updated_at, program_workouts(count), client:profiles!programs_client_id_fkey(full_name, email)")
    .eq("trainer_id", profile.id)
    .order("updated_at", { ascending: false });
  if (!showArchived) query = query.neq("status", "archived");
  const { data: programs } = await query;
  const templates = (programs ?? []).filter((p) => !p.client_id);
  const assigned = (programs ?? []).filter((p) => p.client_id);

  // Last logged session per client program, for a quick pulse.
  const clientIds = [...new Set(assigned.map((p) => p.client_id!))];
  const { data: lastLogs } = clientIds.length
    ? await supabase
        .from("workout_logs")
        .select("client_id, performed_on, pain_flag")
        .in("client_id", clientIds)
        .order("performed_on", { ascending: false })
        .limit(200)
    : { data: [] };
  const lastByClient = new Map<string, { performed_on: string; pain_flag: boolean }>();
  for (const l of lastLogs ?? []) if (!lastByClient.has(l.client_id)) lastByClient.set(l.client_id, l);
  const today = todayInTz(profile.timezone);

  return (
    <div>
      <PageHeader
        title="Programs"
        description="Build reusable templates, then assign them to clients with a start date."
        actions={
          <>
            <LinkButton href={showArchived ? "/coach/programs" : "/coach/programs?archived=1"} variant="ghost">
              {showArchived ? "Hide archived" : "Show archived"}
            </LinkButton>
            <LinkButton href="/coach/programs/new">New program</LinkButton>
          </>
        }
      />

      <section aria-labelledby="templates-h" className="mb-10">
        <h2 id="templates-h" className="mb-3 text-lg font-semibold">Templates</h2>
        {templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            description="Create a template once (e.g. a 4-week strength block) and assign it to as many clients as you like."
            action={<LinkButton href="/coach/programs/new" size="sm">Create a template</LinkButton>}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((p) => (
              <li key={p.id}>
                <Link href={`/coach/programs/${p.id}`} className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-brand">
                  <Card className="h-full transition-colors hover:border-brand/50">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>{p.name}</CardTitle>
                      <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE]}>{p.status === "active" ? "Published" : p.status}</Badge>
                    </div>
                    {p.goal ? <p className="mt-1 text-sm text-zinc-500">{p.goal}</p> : null}
                    <p className="mt-3 text-xs text-zinc-500">
                      {p.duration_weeks} week{p.duration_weeks === 1 ? "" : "s"} · {p.program_workouts?.[0]?.count ?? 0} workouts
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="clients-h">
        <h2 id="clients-h" className="mb-3 text-lg font-semibold">Client programs</h2>
        {assigned.length === 0 ? (
          <EmptyState title="No client programs yet" description="Open a template and assign it to a client, or create a program directly for one client." />
        ) : (
          <ul className="flex flex-col gap-2">
            {assigned.map((p) => {
              const pos = p.start_date ? programPosition(p.start_date, p.duration_weeks, today) : null;
              const last = lastByClient.get(p.client_id!);
              return (
                <li key={p.id}>
                  <Link href={`/coach/programs/${p.id}`} className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-brand">
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-brand/50">
                      <div className="min-w-0">
                        <p className="font-semibold">{displayName(p.client)}</p>
                        <p className="truncate text-sm text-zinc-500">
                          {p.name}
                          {p.start_date ? ` · starts ${longDateLabel(p.start_date)}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        {p.status === "active" && pos ? <span>Week {pos.week} of {p.duration_weeks}</span> : null}
                        {last ? <span>Last workout {longDateLabel(last.performed_on, { month: "short", day: "numeric" })}</span> : <span>No workouts logged</span>}
                        {last?.pain_flag ? <Badge tone="red">Pain reported</Badge> : null}
                        <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE]}>{p.status}</Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
