import { requireClient } from "@/lib/auth";
import { ensureConversationId, loadThread, shareableWorkouts } from "@/lib/comms/thread";
import { ChatThread } from "@/components/comms/chat-thread";
import { Alert } from "@/components/ui";

export const metadata = { title: "Messages" };

export default async function ClientMessagesPage() {
  const { profile, business } = await requireClient();
  const conversationId = await ensureConversationId(business.id, profile.id);
  const [thread, workouts] = await Promise.all([
    conversationId ? loadThread(conversationId, "client") : null,
    shareableWorkouts(profile.id, business.id),
  ]);
  if (!conversationId || !thread) {
    return <Alert tone="red">We couldn&apos;t open your messages. Please refresh and try again.</Alert>;
  }

  return (
    <ChatThread
      conversationId={conversationId}
      viewerId={profile.id}
      viewerIsStaff={false}
      timezone={profile.timezone}
      other={{
        id: business.id,
        name: `${business.name} team`,
        avatarUrl: business.logo_url,
        subtitle: "Your coaches reply here",
      }}
      people={thread.people}
      clientId={profile.id}
      initialMessages={thread.messages}
      initialUrls={thread.urls}
      initialOtherLastReadAt={thread.otherLastReadAt}
      initialHasMore={thread.hasMore}
      initialUnread={thread.unread}
      workouts={workouts}
    />
  );
}
