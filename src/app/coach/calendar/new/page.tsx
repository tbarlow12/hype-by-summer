import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName } from "@/lib/format";
import { coachesForType, listCoaches } from "@/lib/scheduling/availability";
import { localDateOf } from "@/lib/scheduling/tz";
import { BookForClientForm } from "./book-for-client-form";
import { bookForClientAction } from "../actions";

export const metadata = { title: "Book a client" };

export default async function BookForClientPage({ searchParams }: PageProps<"/coach/calendar/new">) {
  const { profile, business } = await requireStaff();
  const { client } = await searchParams;
  const supabase = await createClient();
  const [{ data: links }, { data: types }, coaches] = await Promise.all([
    supabase.from("business_clients").select("client_id, primary_coach_id").eq("business_id", business.id).neq("status", "archived"),
    supabase
      .from("session_types")
      .select("id, name, credits_required, price_cents, is_consultation, coach_ids")
      .eq("business_id", business.id)
      .eq("active", true)
      .order("sort_order"),
    listCoaches(business.id, { bookableOnly: true }),
  ]);
  const ids = (links ?? []).map((l) => l.client_id);
  const primaryOf = new Map((links ?? []).map((l) => [l.client_id, l.primary_coach_id]));
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, phone, sms_opt_in").in("id", ids)
    : { data: [] as { id: string; full_name: string | null; email: string; phone: string | null; sms_opt_in: boolean }[] };
  // Total balance per client (any session type) for the hint; exact check happens on booking.
  const admin = createAdminClient();
  const balances = await Promise.all(
    (profiles ?? []).map(async (p) => (await admin.rpc("credit_balance", { p_client: p.id, p_business: business.id })).data ?? 0),
  );
  const clients = (profiles ?? [])
    .map((p, i) => ({
      id: p.id,
      name: displayName(p),
      phone: p.phone,
      smsOptIn: p.sms_opt_in,
      credits: balances[i] ?? 0,
      primaryCoachId: primaryOf.get(p.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sessionTypes = (types ?? [])
    .map((t) => ({
      id: t.id,
      name: t.name,
      creditsRequired: t.credits_required,
      free: t.is_consultation || t.price_cents === 0,
      coaches: coachesForType(t, coaches).map((c) => ({ id: c.id, name: c.id === profile.id ? `${c.name} (you)` : c.name })),
    }))
    .filter((t) => t.coaches.length > 0);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Book a client" actions={<Link href="/coach/calendar" className="text-sm font-medium text-brand hover:underline">← Calendar</Link>} />
      {clients.length === 0 ? (
        <EmptyState title="No clients yet" description="Add a client first, then book sessions for them." action={<LinkButton href="/coach/clients">Go to clients</LinkButton>} />
      ) : sessionTypes.length === 0 ? (
        <EmptyState title="No bookable session types" description="Session types need at least one bookable coach." action={<LinkButton href="/coach/session-types">Session types</LinkButton>} />
      ) : (
        <Card>
          <BookForClientForm
            clients={clients}
            sessionTypes={sessionTypes}
            selfId={profile.id}
            defaultClientId={typeof client === "string" && clients.some((c) => c.id === client) ? client : undefined}
            today={localDateOf(new Date(), profile.timezone)}
            action={bookForClientAction}
          />
        </Card>
      )}
    </div>
  );
}
