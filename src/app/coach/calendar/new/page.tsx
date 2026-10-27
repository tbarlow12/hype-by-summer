import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName } from "@/lib/format";
import { localDateOf } from "@/lib/scheduling/tz";
import { BookForClientForm } from "./book-for-client-form";
import { bookForClientAction } from "../actions";

export const metadata = { title: "Book a client" };

export default async function BookForClientPage({ searchParams }: PageProps<"/coach/calendar/new">) {
  const profile = await requireTrainer();
  const { client } = await searchParams;
  const supabase = await createClient();
  const [{ data: links }, { data: types }] = await Promise.all([
    supabase.from("trainer_clients").select("client_id").eq("trainer_id", profile.id).neq("status", "archived"),
    supabase.from("session_types").select("id, name, credits_required, price_cents, is_consultation").eq("trainer_id", profile.id).eq("active", true).order("sort_order"),
  ]);
  const ids = (links ?? []).map((l) => l.client_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, phone, sms_opt_in").in("id", ids)
    : { data: [] as { id: string; full_name: string | null; email: string; phone: string | null; sms_opt_in: boolean }[] };
  // Total balance per client (any session type) for the hint; exact check happens on booking.
  const admin = createAdminClient();
  const balances = await Promise.all(
    (profiles ?? []).map(async (p) => (await admin.rpc("credit_balance", { p_client: p.id, p_trainer: profile.id })).data ?? 0),
  );
  const clients = (profiles ?? [])
    .map((p, i) => ({ id: p.id, name: displayName(p), phone: p.phone, smsOptIn: p.sms_opt_in, credits: balances[i] ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-2xl">
      <PageHeader title="Book a client" actions={<Link href="/coach/calendar" className="text-sm font-medium text-brand hover:underline">← Calendar</Link>} />
      {clients.length === 0 ? (
        <EmptyState title="No clients yet" description="Add a client first, then book sessions for them." action={<LinkButton href="/coach/clients">Go to clients</LinkButton>} />
      ) : (types ?? []).length === 0 ? (
        <EmptyState title="No active session types" action={<LinkButton href="/coach/session-types/new">Create a session type</LinkButton>} />
      ) : (
        <Card>
          <BookForClientForm
            clients={clients}
            sessionTypes={(types ?? []).map((t) => ({ id: t.id, name: t.name, creditsRequired: t.credits_required, free: t.is_consultation || t.price_cents === 0 }))}
            defaultClientId={typeof client === "string" && clients.some((c) => c.id === client) ? client : undefined}
            today={localDateOf(new Date(), profile.timezone)}
            action={bookForClientAction}
          />
        </Card>
      )}
    </div>
  );
}
