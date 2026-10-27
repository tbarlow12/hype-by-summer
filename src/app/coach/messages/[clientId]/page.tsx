import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { ensureConversationId, loadThread } from "@/lib/comms/thread";
import { ChatThread } from "@/components/comms/chat-thread";
import { Alert } from "@/components/ui";

export const metadata = { title: "Conversation" };

export default async function CoachThreadPage({ params }: PageProps<"/coach/messages/[clientId]">) {
  const profile = await requireTrainer();
  const { clientId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) notFound();
  const supabase = await createClient();

  const { data: rel } = await supabase
    .from("trainer_clients")
    .select("status, profiles!trainer_clients_client_id_fkey(id, full_name, email, avatar_url)")
    .eq("trainer_id", profile.id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!rel?.profiles) notFound();

  const conversationId = await ensureConversationId(profile.id, clientId);
  const thread = conversationId ? await loadThread(conversationId, profile.id) : null;
  if (!conversationId || !thread) {
    return <Alert tone="red">We couldn&apos;t open this conversation. Please refresh and try again.</Alert>;
  }
  const client = rel.profiles;

  return (
    <div>
      <div className="mb-3 hidden items-center justify-between lg:flex">
        <Link href="/coach/messages" className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← All conversations
        </Link>
        <Link href={`/coach/clients/${clientId}`} className="text-sm font-medium text-brand hover:underline">
          View client profile
        </Link>
      </div>
      {rel.status === "archived" ? (
        <div className="mb-3">
          <Alert tone="amber">This client is archived. They can no longer see new media you send.</Alert>
        </div>
      ) : null}
      <ChatThread
        conversationId={conversationId}
        viewerId={profile.id}
        viewerIsTrainer
        timezone={profile.timezone}
        other={{ id: client.id, name: displayName(client), avatarUrl: client.avatar_url, subtitle: client.email }}
        clientId={clientId}
        initialMessages={thread.messages}
        initialUrls={thread.urls}
        initialOtherLastReadAt={thread.otherLastReadAt}
        initialHasMore={thread.hasMore}
        initialUnread={thread.unread}
        backHref="/coach/messages"
      />
    </div>
  );
}
