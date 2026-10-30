import type { EmailInput } from "@/lib/email";
import type { Brand } from "@/lib/tenant";

/** "You have a new message" email for chat (sent only after the recipient has been away a while). */
export function newMessageEmail(input: {
  brand: Brand;
  to: string;
  recipientName?: string | null;
  senderName: string;
  preview: string;
  /** App-relative link to the thread. */
  link: string;
}): EmailInput {
  const preview = input.preview.length > 280 ? `${input.preview.slice(0, 277)}…` : input.preview;
  return {
    brand: input.brand,
    to: input.to,
    subject: `New message from ${input.senderName}`,
    heading: `${input.senderName} sent you a message`,
    paragraphs: [
      input.recipientName ? `Hi ${input.recipientName.split(" ")[0]},` : "Hi,",
      preview ? `“${preview}”` : `${input.senderName} sent you an attachment.`,
    ],
    cta: { label: "Reply", url: new URL(input.link, input.brand.siteUrl).toString() },
    footerNote: `You're getting this because you have unread messages with ${input.brand.name}. We only email when you haven't checked the thread for a while.`,
  };
}
