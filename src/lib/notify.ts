import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/env";

type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  body?: string;
  /** App-relative link, e.g. /me/bookings */
  link?: string;
  /** Also email the user (uses profile email). */
  email?: boolean;
};

/** In-app notification (+ optional email). Best-effort; never throws. */
export async function notify(input: NotifyInput): Promise<void> {
  const admin = createAdminClient();
  try {
    await admin.from("notifications").insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    });
    if (input.email) {
      const { data: profile } = await admin
        .from("profiles")
        .select("email")
        .eq("id", input.userId)
        .single();
      if (profile?.email) {
        await sendEmail({
          to: profile.email,
          subject: input.title,
          heading: input.title,
          paragraphs: input.body ? [input.body] : [],
          cta: input.link ? { label: "Open", url: absoluteUrl(input.link) } : undefined,
        });
      }
    }
  } catch (err) {
    console.error("[notify] failed", err);
  }
}
