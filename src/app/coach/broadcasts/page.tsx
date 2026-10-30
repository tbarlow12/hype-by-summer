import { Badge, EmptyState, PageHeader, Table } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, titleCase } from "@/lib/format";
import { AUDIENCES, AUDIENCE_LABELS } from "@/lib/comms/broadcast";
import { BroadcastComposer } from "./broadcast-composer";

export const metadata = { title: "Broadcasts" };

const CHANNEL_LABEL: Record<string, string> = { in_app: "In-app", email: "Email", sms: "SMS" };

export default async function BroadcastsPage() {
  const { profile, business } = await requireManager();
  const supabase = await createClient();
  const { data: history } = await supabase
    .from("broadcasts")
    .select("id, audience, subject, channels, recipient_count, emails_sent, emails_failed, sms_sent, sent_at, created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <PageHeader title="Broadcasts" description={`Send one announcement from ${business.name} to a whole group: schedule changes, new programs, promos.`} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <BroadcastComposer audiences={AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABELS[a] }))} />
        <div className="min-w-0">
          <h2 className="mb-3 text-sm font-semibold">History</h2>
          {!history?.length ? (
            <EmptyState title="No broadcasts yet" description="Everything you send shows up here with delivery counts." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Audience</th>
                  <th>Delivered</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id}>
                    <td className="max-w-56">
                      <p className="truncate font-medium">{b.subject}</p>
                      <p className="text-xs text-zinc-500">
                        {b.sent_at ? formatDateTime(b.sent_at, profile.timezone, "MMM d, h:mm a") : "Not sent"}
                      </p>
                    </td>
                    <td>
                      <p className="text-sm">{AUDIENCE_LABELS[b.audience as keyof typeof AUDIENCE_LABELS] ?? titleCase(b.audience)}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {b.channels.map((c) => (
                          <Badge key={c}>{CHANNEL_LABEL[c] ?? c}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="text-sm whitespace-nowrap">
                      <p>{b.recipient_count} recipients</p>
                      <p className="text-xs text-zinc-500">
                        {[
                          b.channels.includes("email") ? `${b.emails_sent} emails${b.emails_failed ? `, ${b.emails_failed} failed` : ""}` : null,
                          b.channels.includes("sms") ? `${b.sms_sent} texts` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
