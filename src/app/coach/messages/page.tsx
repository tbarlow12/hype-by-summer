import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Card, EmptyState, Input, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDateTime } from "@/lib/format";
import { dayKey, messagePreview } from "@/lib/comms/policy";
import { loadInbox } from "@/lib/comms/thread";

export const metadata = { title: "Messages" };

export default async function CoachMessagesPage({ searchParams }: PageProps<"/coach/messages">) {
  const profile = await requireTrainer();
  const { q: rawQ } = await searchParams;
  const q = (typeof rawQ === "string" ? rawQ : "").trim().toLowerCase();
  const supabase = await createClient();

  const [inbox, { data: clients }] = await Promise.all([
    loadInbox(),
    supabase
      .from("trainer_clients")
      .select("client_id, status, profiles!trainer_clients_client_id_fkey(full_name, email)")
      .eq("trainer_id", profile.id)
      .neq("status", "archived"),
  ]);

  const rows = inbox.filter((r) => r.trainer_id === profile.id);
  const withMessages = rows.filter((r) => r.last_message_at);
  const filtered = q
    ? withMessages.filter((r) => `${r.other_name ?? ""} ${r.other_email ?? ""}`.toLowerCase().includes(q))
    : withMessages;
  const unreadTotal = withMessages.filter((r) => r.unread_count > 0).length;
  const today = dayKey(new Date().toISOString(), profile.timezone);

  const pickable = (clients ?? [])
    .map((c) => ({ id: c.client_id, name: displayName(c.profiles) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function openThread(formData: FormData) {
    "use server";
    const id = String(formData.get("client") ?? "");
    if (/^[0-9a-f-]{36}$/i.test(id)) redirect(`/coach/messages/${id}`);
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        description={unreadTotal ? `${unreadTotal} conversation${unreadTotal === 1 ? "" : "s"} waiting on you` : "You're all caught up."}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <form role="search" className="flex gap-2">
          <label htmlFor="q" className="sr-only">
            Search conversations
          </label>
          <Input id="q" name="q" type="search" defaultValue={typeof rawQ === "string" ? rawQ : ""} placeholder="Search by client name or email" />
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
          title={q ? "No conversations match" : "No conversations yet"}
          description={
            q
              ? "Try a different name or email."
              : pickable.length
                ? "Pick a client above to send your first message. Clients can also message you from their portal."
                : "Once clients join, you can message them here."
          }
          action={q ? <Link href="/coach/messages" className={buttonClass("outline", "sm")}>Clear search</Link> : undefined}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul>
            {filtered.map((r) => {
              const unread = r.unread_count > 0;
              const mine = r.last_sender_id === profile.id;
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
                    <Avatar name={r.other_name ?? r.other_email} src={r.other_avatar_url} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn("truncate", unread ? "font-bold" : "font-medium")}>{r.other_name || r.other_email}</p>
                        <span className={cn("shrink-0 text-xs", unread ? "font-semibold text-brand" : "text-zinc-500")}>{when}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className={cn("truncate text-sm", unread ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500")}>
                          {r.last_kind === "system" ? "" : mine ? "You: " : ""}
                          {preview}
                        </p>
                        {unread ? (
                          <span className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
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
