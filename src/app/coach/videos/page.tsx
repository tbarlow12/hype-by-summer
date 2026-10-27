import Link from "next/link";
import { Avatar, Badge, EmptyState, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDateTime } from "@/lib/format";
import { formatClock } from "@/lib/comms/policy";

export const metadata = { title: "Form checks" };

const STATUSES = [
  { value: "pending", label: "Awaiting review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "all", label: "All" },
] as const;

export default async function CoachVideosPage({ searchParams }: PageProps<"/coach/videos">) {
  const profile = await requireTrainer();
  const sp = await searchParams;
  const clientFilter = typeof sp.client === "string" && /^[0-9a-f-]{36}$/i.test(sp.client) ? sp.client : "";
  const status = STATUSES.some((s) => s.value === sp.status) ? (sp.status as (typeof STATUSES)[number]["value"]) : "all";
  const supabase = await createClient();

  let query = supabase
    .from("video_submissions")
    .select(
      "id, title, status, created_at, reviewed_at, duration_seconds, client_id, exercises(name), video_comments(count), profiles!video_submissions_client_id_fkey(full_name, email, avatar_url)",
    )
    .eq("trainer_id", profile.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(200);
  if (clientFilter) query = query.eq("client_id", clientFilter);
  if (status === "pending") query = query.eq("status", "pending_review");
  if (status === "reviewed") query = query.eq("status", "reviewed");

  const [{ data: subs }, { data: clients }] = await Promise.all([
    query,
    supabase
      .from("trainer_clients")
      .select("client_id, profiles!trainer_clients_client_id_fkey(full_name, email)")
      .eq("trainer_id", profile.id),
  ]);

  // Pending first (oldest waiting at the top), then reviewed newest first.
  const pending = (subs ?? []).filter((s) => s.status === "pending_review").reverse();
  const done = (subs ?? []).filter((s) => s.status !== "pending_review");
  const rows = [...pending, ...done];
  const clientOptions = (clients ?? [])
    .map((c) => ({ id: c.client_id, name: displayName(c.profiles) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="Form checks"
        description={pending.length ? `${pending.length} video${pending.length === 1 ? "" : "s"} waiting for your review` : "Queue is clear. Nice work."}
      />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="client" className="mb-1 block text-xs font-medium text-zinc-500">
            Client
          </label>
          <Select id="client" name="client" defaultValue={clientFilter} className="w-56">
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-zinc-500">
            Status
          </label>
          <Select id="status" name="status" defaultValue={status} className="w-44">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <button className={buttonClass("outline")}>Filter</button>
        {clientFilter || status !== "all" ? (
          <Link href="/coach/videos" className={buttonClass("ghost")}>
            Reset
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={clientFilter || status !== "all" ? "No videos match these filters" : "No form checks yet"}
          description="When clients upload a lift from their portal, it lands here for review."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((s) => {
            const comments = s.video_comments?.[0]?.count ?? 0;
            const waiting = s.status === "pending_review";
            return (
              <li key={s.id}>
                <Link
                  href={`/coach/videos/${s.id}`}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border bg-white p-4 transition-colors hover:border-brand/40 dark:bg-zinc-900",
                    waiting ? "border-amber-300 dark:border-amber-800" : "border-zinc-200 dark:border-zinc-800",
                  )}
                >
                  <Avatar name={displayName(s.profiles)} src={s.profiles?.avatar_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {[
                        displayName(s.profiles),
                        s.exercises?.name,
                        s.duration_seconds ? formatClock(Number(s.duration_seconds)) : null,
                        formatDateTime(s.created_at, profile.timezone, "MMM d, h:mm a"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={waiting ? "amber" : "green"}>{waiting ? "Needs review" : "Reviewed"}</Badge>
                    {comments ? <span className="text-xs text-zinc-500">{comments} note{comments === 1 ? "" : "s"}</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
