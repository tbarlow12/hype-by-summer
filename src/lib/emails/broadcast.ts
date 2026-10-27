import type { EmailInput } from "@/lib/email";
import { absoluteUrl, BRAND_NAME } from "@/lib/env";

/**
 * A trainer broadcast. Leads get an unsubscribe link (marketing); clients get a
 * note that this is an update from their coach.
 */
export function broadcastEmail(input: {
  to: string;
  subject: string;
  body: string;
  trainerName: string;
  firstName?: string | null;
  /** Leads only: token for /unsubscribe/[token]. */
  unsubscribeToken?: string | null;
  replyTo?: string;
}): EmailInput {
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const greeting = input.firstName ? [`Hi ${input.firstName.split(" ")[0]},`] : [];
  const unsubscribeUrl = input.unsubscribeToken ? absoluteUrl(`/unsubscribe/${input.unsubscribeToken}`) : null;
  return {
    to: input.to,
    subject: input.subject,
    heading: input.subject,
    paragraphs: [...greeting, ...paragraphs, `— ${input.trainerName}`],
    replyTo: input.replyTo,
    footerNote: unsubscribeUrl
      ? `You're receiving this because you signed up with ${BRAND_NAME}. Unsubscribe: ${unsubscribeUrl}`
      : `You're receiving this because you train with ${input.trainerName} at ${BRAND_NAME}.`,
  };
}

/** List-Unsubscribe headers for marketing emails to leads. */
export function unsubscribeHeaders(token: string | null | undefined): Record<string, string> | undefined {
  if (!token) return undefined;
  return { "List-Unsubscribe": `<${absoluteUrl(`/unsubscribe/${token}`)}>` };
}
