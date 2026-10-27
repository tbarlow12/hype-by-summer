import { requireClient, getClientTrainerId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { ensureConversationId, loadThread, shareableWorkouts } from "@/lib/comms/thread";
import { ChatThread } from "@/components/comms/chat-thread";
import { Alert, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Messages" };

export default async function ClientMessagesPage() {
  const profile = await requireClient();
  const trainerId = await getClientTrainerId(profile.id);
  if (!trainerId) {
    return (
      <div>
        <PageHeader title="Messages" />
        <EmptyState title="No coach yet" description="Once you're connected with a coach, your conversation will appear here." />
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: trainer }, { data: storefront }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, avatar_url").eq("id", trainerId).maybeSingle(),
    supabase.from("trainer_profiles").select("business_name").eq("trainer_id", trainerId).maybeSingle(),
  ]);
  const conversationId = await ensureConversationId(trainerId, profile.id);
  const [thread, workouts] = await Promise.all([
    conversationId ? loadThread(conversationId, profile.id) : null,
    shareableWorkouts(profile.id),
  ]);
  if (!conversationId || !thread) {
    return <Alert tone="red">We couldn&apos;t open your messages. Please refresh and try again.</Alert>;
  }

  return (
    <ChatThread
      conversationId={conversationId}
      viewerId={profile.id}
      viewerIsTrainer={false}
      timezone={profile.timezone}
      other={{
        id: trainerId,
        name: displayName(trainer),
        avatarUrl: trainer?.avatar_url ?? null,
        subtitle: storefront?.business_name ? `Your coach · ${storefront.business_name}` : "Your coach",
      }}
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
