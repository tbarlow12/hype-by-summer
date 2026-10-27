import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Card, LinkButton } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { BRAND_NAME } from "@/lib/env";
import { unsubscribeAction } from "../../actions";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;
  const valid = /^[0-9a-f]{20,80}$/i.test(token);
  const { data: lead } = valid
    ? await createAdminClient().from("leads").select("email, unsubscribed_at").eq("unsubscribe_token", token).maybeSingle()
    : { data: null };

  return (
    <div className="px-4 py-16 sm:py-24">
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-2xl font-black tracking-tight">Email preferences</h1>
        {!lead ? (
          <div className="mt-6 space-y-4">
            <Alert tone="amber">This unsubscribe link is invalid or has expired.</Alert>
            <LinkButton href="/" variant="outline">
              Back to {BRAND_NAME}
            </LinkButton>
          </div>
        ) : lead.unsubscribed_at ? (
          <div className="mt-6 space-y-4">
            <Alert tone="green">
              {maskEmail(lead.email)} is unsubscribed. You won&apos;t receive marketing emails from {BRAND_NAME}.
            </Alert>
            <LinkButton href="/" variant="outline">
              Back to {BRAND_NAME}
            </LinkButton>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Stop marketing emails to <span className="font-semibold">{maskEmail(lead.email)}</span>? You&apos;ll still get
              emails about bookings and payments you make.
            </p>
            <ActionForm action={unsubscribeAction} className="mt-6 flex flex-col items-center gap-3">
              <input type="hidden" name="token" value={token} />
              <SubmitButton size="lg" pendingLabel="Unsubscribing…" className="w-full">
                Unsubscribe
              </SubmitButton>
            </ActionForm>
          </div>
        )}
      </Card>
    </div>
  );
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`;
}
