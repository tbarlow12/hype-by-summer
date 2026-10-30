import type { EmailInput } from "@/lib/email";
import type { Brand } from "@/lib/tenant";

/** Absolute one-click unsubscribe URL on the business's own site. */
export function unsubscribeUrl(brand: Pick<Brand, "siteUrl">, token: string): string {
  return new URL(`/unsubscribe/${encodeURIComponent(token)}`, brand.siteUrl).toString();
}

/**
 * A business broadcast. Leads get an unsubscribe link (marketing); clients get
 * a note that this is an update from the business they train with.
 */
export function broadcastEmail(input: {
  brand: Brand;
  to: string;
  subject: string;
  body: string;
  /** Sign-off, e.g. the sender's name. */
  senderName: string;
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
  const unsub = input.unsubscribeToken ? unsubscribeUrl(input.brand, input.unsubscribeToken) : null;
  const signOff = input.senderName === input.brand.name ? input.brand.name : `${input.senderName}, ${input.brand.name}`;
  return {
    brand: input.brand,
    to: input.to,
    subject: input.subject,
    heading: input.subject,
    paragraphs: [...greeting, ...paragraphs, `— ${signOff}`],
    replyTo: input.replyTo,
    footerNote: unsub
      ? `You're receiving this because you signed up with ${input.brand.name}. Unsubscribe: ${unsub}`
      : `You're receiving this because you train with ${input.brand.name}.`,
  };
}

/** List-Unsubscribe headers for marketing emails to leads. */
export function unsubscribeHeaders(brand: Pick<Brand, "siteUrl">, token: string | null | undefined): Record<string, string> | undefined {
  if (!token) return undefined;
  return { "List-Unsubscribe": `<${unsubscribeUrl(brand, token)}>` };
}
