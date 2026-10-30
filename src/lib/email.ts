import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/env.server";
import type { Brand } from "@/lib/tenant";

export type EmailInput = {
  /** The business the email is from (name, colors, logo, reply-to). Required: emails are white-labeled. */
  brand: Brand;
  to: string | string[];
  subject: string;
  /** Plain paragraphs; rendered into the branded HTML layout. */
  heading?: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footerNote?: string;
  replyTo?: string;
  attachments?: { filename: string; content: string | Buffer; contentType?: string }[];
};

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderEmail({ brand, heading, paragraphs, cta, footerNote }: EmailInput): { html: string; text: string } {
  const { brand: fill, onBrand, textLight } = brand.palette;
  const header = brand.logoUrl
    ? `<img src="${escape(brand.logoUrl)}" alt="${escape(brand.name)}" height="36" style="display:block;height:36px;width:auto">`
    : escape(brand.name);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-weight:800;font-size:18px;letter-spacing:-0.02em;color:${textLight};padding-bottom:16px">${header}</td></tr>
${heading ? `<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">${escape(heading)}</td></tr>` : ""}
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px">${escape(p).replace(/\n/g, "<br>")}</td></tr>`).join("")}
${cta ? `<tr><td style="padding:12px 0 8px"><a href="${escape(cta.url)}" style="display:inline-block;background:${fill};color:${onBrand};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escape(cta.label)}</a></td></tr>` : ""}
<tr><td style="font-size:12px;color:#71717a;padding-top:24px;border-top:1px solid #eee">${footerNote ? `${escape(footerNote)}<br>` : ""}<a href="${escape(brand.siteUrl)}" style="color:#71717a">${escape(brand.name)}</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = [heading, ...paragraphs, cta ? `${cta.label}: ${cta.url}` : null, footerNote]
    .filter(Boolean)
    .join("\n\n");
  return { html, text };
}

/** Sends via Resend when configured; otherwise logs (local dev). Never throws. */
export async function sendEmail(input: EmailInput): Promise<{ ok: boolean; id?: string }> {
  const { html, text } = renderEmail(input);
  const brand = input.brand;
  const key = serverEnv.resendApiKey();
  if (!key) {
    console.info(`[email:dev] to=${String(input.to)} subject="${input.subject}"\n${text}`);
    return { ok: true };
  }
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({
      // Display name is the business; the address is the platform's verified sender.
      from: `${brand.name.replace(/["<>]/g, "")} <${serverEnv.emailFromAddress()}>`,
      to: input.to,
      subject: input.subject,
      html,
      text,
      replyTo: input.replyTo ?? brand.replyTo ?? undefined,
      attachments: input.attachments,
    });
    if (error) {
      console.error("[email] send failed", error);
      return { ok: false };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[email] send failed", err);
    return { ok: false };
  }
}
