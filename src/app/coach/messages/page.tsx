import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Card, EmptyState, Input, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDateTime } from "@/lib/format";
import { dayKey, filterInbox, messagePreview } from "@/lib/comms/policy";
import { loadInbox, teamPeople } from "@/lib/comms/thread";

export const metadata = { title: "Messages" };

export default async function CoachMessagesPage({ searchParams }: PageProps<"/coach/messages">) {
  const { profile, business, membership } = await requireStaff();
  const sp = await searchParams;
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  // Coaches start on their own clients; managers on the whole team inbox.
  const view = sp.view === "mine" || sp.view === "all" ? sp.view : isManager(membership) ? "all" : "mine";
  const supabase = await createClient();

  const [inbox, team, { data: clients }] = await Promise.all([
    loadInbox(business.id),
    teamPeople(business.id),
    supabase
      .from("business_clients")
      .select("client_id, status, primary_coach_id, profiles!business_clients_client_id_fkey(full_name, email)")
      .eq("business_id", business.id)
      .neq("status", "archived"),
  ]);

  const mineAll = filterInbox(inbox, { mineFor: profile.id });
  const everyone = filterInbox(inbox, {});
  const filtered = filterInbox(inbox, { mineFor: view === "mine" ? profile.id : null, q: rawQ });
  const unreadMine = mineAll.filter((r) => r.unread_count > 0).length;
  const unreadAll = everyone.filter((r) => r.unread_count > 0).length;
  const unreadTotal = view === "mine" ? unreadMine : unreadAll;
  const today = dayKey(new Date().toISOString(), profile.timezone);
  const q = rawQ.trim();
  const viewHref = (v: "mine" | "all") => `/coach/messages?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const pickable = (clients ?? [])
    .filter((c) => view === "all" || c.primary_coach_id === profile.id)
    .map((c) => ({ id: c.client_id, name: displayName(c.profiles) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function openThread(formData: FormData) {
    "use server";
    const id = String(formData.get("client") ?? "");
    if (/^[0-9a-f-]{36}$/i.test(id)) redirect(`/coach/messages/${id}`); // the thread page re-checks access
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        description={
          unreadTotal
            ? `${unreadTotal} conversation${unreadTotal === 1 ? "" : "s"} waiting on ${view === "mine" ? "you" : "the team"}`
            : "You're all caught up."
        }
      />

      <nav aria-label="Inbox view" className="mb-4 inline-flex rounded-full border border-zinc-200 p-1 text-sm dark:border-zinc-800">
        {(
          [
            ["mine", "My clients", unreadMine],
            ["all", "Everyone", unreadAll],
          ] as const
        ).map(([v, label, n]) => (
          <Link
            key={v}
            href={viewHref(v)}
            aria-current={view === v ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 font-medium transition-colors",
              view === v ? "bg-brand text-on-brand" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {label}
            {n ? <span className="ml-1.5 text-xs opacity-80">({n})</span> : null}
          </Link>
        ))}
      </nav>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <form role="search" className="flex gap-2">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="q" className="sr-only">
            Search conversations
          </label>
          <Input id="q" name="q" type="search" defaultValue={rawQ} placeholder="Search by client name or email" />
          <button className={buttonClass("outline")}>Search</button>
        </form>
        {pickable.length ? (
          <form action={openThread} className="flex gap-2">
            <label htmlFor="client" className="sr-only">
              Start a conversation with
            </label>
            <Select id="client" name="client" defaultValue="" required className="sm:w-56">
              <option value="" disabled>
                New message to…
              </option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <button className={buttonClass("primary")}>Open</button>
          </form>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={q ? "No conversations match" : view === "mine" ? "No conversations with your clients yet" : "No conversations yet"}
          description={
            q
              ? "Try a different name or email."
              : view === "mine" && everyone.length
                ? "Threads with clients you're the primary coach for show here. Switch to Everyone to see the whole team inbox."
                : pickable.length
                  ? "Pick a client above to send the first message. Clients can also message the team from their portal."
                  : "Once clients join, you can message them here."
          }
          action={q ? <Link href={viewHref(view)} className={buttonClass("outline", "sm")}>Clear search</Link> : undefined}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul>
            {filtered.map((r) => {
              const unread = r.unread_count > 0;
              const mine = r.last_sender_id === profile.id;
              const fromTeam = Boolean(r.last_sender_id) && r.last_sender_id !== r.client_id;
              const preview = messagePreview({ body: r.last_body, kind: r.last_kind ?? "text", deleted: r.last_deleted });
              const when = r.last_message_at
                ? formatDateTime(r.last_message_at, profile.timezone, dayKey(r.last_message_at, profile.timezone) === today ? "h:mm a" : "MMM d")
                : "";
              return (
                <li key={r.conversation_id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <Link
                    href={`/coach/messages/${r.client_id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <Avatar name={r.client_name ?? r.client_email} src={r.client_avatar_url} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn("truncate", unread ? "font-bold" : "font-medium")}>{r.client_name || r.client_email}</p>
                        <span className={cn("shrink-0 text-xs", unread ? "font-semibold text-brand" : "text-zinc-500")}>{when}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={cn("truncate text-sm", unread ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500")}>
                          {r.last_kind === "system" ? "" : mine ? "You: " : fromTeam ? `${team[r.last_sender_id!]?.name.split(" ")[0] ?? "Team"}: ` : ""}
                          {preview}
                        </p>
                        {unread ? (
                          <span className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-on-brand">
                            <span className="sr-only">Unread messages: </span>
                            {r.unread_count}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
