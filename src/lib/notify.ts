import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { brandForBusiness } from "@/lib/tenant";

type NotifyInput = {
  userId: string;
  /** Business the notification belongs to (null = platform notice). */
  businessId: string | null;
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
      business_id: input.businessId,
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
      if (profile?.email && input.businessId) {
        const brand = await brandForBusiness(input.businessId);
        await sendEmail({
          brand,
          to: profile.email,
          subject: input.title,
          heading: input.title,
          paragraphs: input.body ? [input.body] : [],
          cta: input.link ? { label: "Open", url: new URL(input.link, brand.siteUrl).toString() } : undefined,
        });
      }
    }
  } catch (err) {
    console.error("[notify] failed", err);
  }
}
