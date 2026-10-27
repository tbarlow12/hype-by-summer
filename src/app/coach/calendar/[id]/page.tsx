import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, buttonClass, Card, CardTitle, Checkbox, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { LOCATION_LABELS, STATUS_LABELS, STATUS_TONES } from "@/lib/scheduling/labels";
import { googleCalendarLink, loadBookingContext } from "@/lib/scheduling/lifecycle";
import { saveTrainerNotesAction, setOutcomeAction, trainerCancelAction, trainerRescheduleAction } from "../actions";

export const metadata = { title: "Booking" };

const PAYMENT_TEXT = { free: "Free", stripe: "Card", credits: "Credits", subscription: "Membership", pay_later: "Pay at session" } as const;

export default async function BookingDetailPage({ params }: PageProps<"/coach/calendar/[id]">) {
  const profile = await requireTrainer();
  const { id } = await params;
  const supabase = await createClient();
  // RLS + explicit trainer filter: only the trainer's own bookings.
  const { data: own } = await supabase.from("bookings").select("id").eq("id", id).eq("trainer_id", profile.id).maybeSingle();
  if (!own) notFound();
  const ctx = await loadBookingContext(own.id);
  if (!ctx) notFound();
  const { booking: b, sessionType: st, trainer, client } = ctx;
  const tz = profile.timezone;

  const [{ data: roster }, { data: payments }, { data: replacement }] = await Promise.all([
    st.capacity > 1
      ? supabase
          .from("bookings")
          .select("id, client_id, guest_name, guest_email, status")
          .eq("session_type_id", st.id)
          .eq("starts_at", b.starts_at)
          .in("status", ["confirmed", "completed", "no_show", "pending_payment"])
      : Promise.resolve({ data: null }),
    supabase.from("payments").select("id, amount_cents, amount_refunded_cents, status, purpose, created_at").eq("booking_id", b.id).order("created_at"),
    b.cancel_reason === "rescheduled"
      ? supabase.from("bookings").select("id").eq("rescheduled_from", b.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const rosterIds = (roster ?? []).map((r) => r.client_id).filter((x): x is string => Boolean(x));
  const { data: rosterProfiles } = rosterIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", rosterIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const rosterName = (r: { client_id: string | null; guest_name: string | null; guest_email: string | null }) =>
    r.client_id ? displayName(rosterProfiles?.find((p) => p.id === r.client_id)) : (r.guest_name ?? r.guest_email ?? "Guest");

  const name = client ? displayName(client) : (b.guest_name ?? b.guest_email ?? "Guest");
  const email = client?.email ?? b.guest_email;
  const phone = b.guest_phone ?? client?.phone;
  const started = Date.parse(b.starts_at) <= new Date().getTime();
  const canCancel = (b.status === "confirmed" || b.status === "pending_payment") && !started;
  const canMark = ["confirmed", "completed", "no_show"].includes(b.status) && started;
  const localValue = formatDateTime(b.starts_at, tz, "yyyy-MM-dd'T'HH:mm");
  const prepaid = b.payment_method === "stripe" || b.payment_method === "credits";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={st.capacity > 1 ? `${st.name} · ${name}` : name}
        description={`${st.name} · ${formatDateTime(b.starts_at, tz, "EEEE, MMMM d · h:mm a")}–${formatDateTime(b.ends_at, tz, "h:mm a")}`}
        actions={<Link href={`/coach/calendar?date=${formatDateTime(b.starts_at, tz, "yyyy-MM-dd")}`} className="text-sm font-medium text-brand hover:underline">← Calendar</Link>}
      />
      {replacement ? (
        <Alert tone="neutral">
          Rescheduled. <Link href={`/coach/calendar/${replacement.id}`} className="font-semibold underline">Open the new booking</Link>
        </Alert>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[b.status]}>{STATUS_LABELS[b.status]}</Badge>
          <Badge>{PAYMENT_TEXT[b.payment_method]}</Badge>
          {b.recurrence_group ? <Badge tone="purple">Recurring</Badge> : null}
          {b.sms_opt_in ? <Badge tone="green">SMS reminders</Badge> : null}
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Client</dt>
            <dd className="font-medium">
              {client ? <Link href={`/coach/clients/${client.id}`} className="hover:text-brand">{name}</Link> : `${name} (guest)`}
            </dd>
            {email ? <dd><a href={`mailto:${email}`} className="text-zinc-600 hover:underline dark:text-zinc-400">{email}</a></dd> : null}
            {phone ? <dd><a href={`tel:${phone}`} className="text-zinc-600 hover:underline dark:text-zinc-400">{phone}</a></dd> : null}
          </div>
          <div>
            <dt className="text-zinc-500">Session</dt>
            <dd className="font-medium">{formatDuration(st.duration_minutes)} · {LOCATION_LABELS[b.location_type]}</dd>
            {b.location_details ? <dd className="text-zinc-600 dark:text-zinc-400">{b.location_details}</dd> : null}
            {b.video_room_url ? (
              <dd>
                <a href={b.video_room_url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                  Join video room
                </a>
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-zinc-500">Payment</dt>
            <dd className="font-medium">
              {b.payment_method === "credits" ? `${b.credits_used} credit${b.credits_used === 1 ? "" : "s"}` : formatMoney(b.price_cents)}
            </dd>
            {(payments ?? []).map((p) => (
              <dd key={p.id} className="text-zinc-600 dark:text-zinc-400">
                {p.purpose}: {formatMoney(p.amount_cents)} · {p.status}
                {p.amount_refunded_cents ? ` (refunded ${formatMoney(p.amount_refunded_cents)})` : ""}
              </dd>
            ))}
          </div>
          <div>
            <dt className="text-zinc-500">Client notes</dt>
            <dd className="whitespace-pre-line">{b.client_notes ?? "—"}</dd>
          </div>
          {b.cancelled_at ? (
            <div className="sm:col-span-2">
              <dt className="text-zinc-500">Cancelled</dt>
              <dd>
                {formatDateTime(b.cancelled_at, tz)} · {b.cancel_reason ?? "No reason given"}
              </dd>
            </div>
          ) : null}
        </dl>
        {b.status === "confirmed" ? (
          <div className="mt-4">
            <a href={googleCalendarLink(ctx)} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "sm")}>
              Add to Google Calendar
            </a>
          </div>
        ) : null}
      </Card>

      {roster && roster.length > 0 ? (
        <Card>
          <CardTitle>
            Attendees ({roster.length}/{st.capacity})
          </CardTitle>
          <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {roster.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <Link href={`/coach/calendar/${r.id}`} className={r.id === b.id ? "font-semibold text-brand" : "hover:text-brand"}>
                  {rosterName(r)}
                </Link>
                <Badge tone={STATUS_TONES[r.status]}>{STATUS_LABELS[r.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canMark ? (
        <Card className="flex flex-col gap-3">
          <CardTitle>Outcome</CardTitle>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={setOutcomeAction}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="status" value="completed" />
              <SubmitButton variant={b.status === "completed" ? "secondary" : "outline"} size="sm" pendingLabel="Saving…">
                Mark completed
              </SubmitButton>
            </ActionForm>
            {b.status !== "confirmed" ? (
              <ActionForm action={setOutcomeAction}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="status" value="confirmed" />
                <SubmitButton variant="ghost" size="sm" pendingLabel="Saving…">
                  Reset to confirmed
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          {b.status !== "no_show" ? (
            <ActionForm action={setOutcomeAction} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="status" value="no_show" />
              {trainer.no_show_fee_cents > 0 && b.client_id ? (
                <Checkbox
                  name="charge_fee"
                  defaultChecked={!prepaid}
                  label={`Charge the ${formatMoney(trainer.no_show_fee_cents)} no-show fee to their card on file`}
                />
              ) : null}
              <div>
                <SubmitButton variant="outline" size="sm" pendingLabel="Saving…">
                  Mark no-show
                </SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardTitle>Private notes</CardTitle>
        <ActionForm action={saveTrainerNotesAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="id" value={b.id} />
          <Textarea name="trainer_notes" defaultValue={b.trainer_notes ?? ""} maxLength={5000} aria-label="Private notes" placeholder="Session notes only you can see" />
          <div>
            <SubmitButton size="sm" variant="outline">
              Save notes
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {b.status === "confirmed" && !started ? (
        <Card>
          <CardTitle>Reschedule</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">Pick any free time (your timezone). Payment and credits carry over; the client gets an updated invite.</p>
          <ActionForm action={trainerRescheduleAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="id" value={b.id} />
            <Field label="New start" htmlFor="starts_at_local" className="flex-1">
              <Input id="starts_at_local" name="starts_at_local" type="datetime-local" defaultValue={localValue} required />
            </Field>
            <SubmitButton pendingLabel="Moving…">Reschedule</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {canCancel ? (
        <Card>
          <CardTitle>Cancel booking</CardTitle>
          <ActionForm action={trainerCancelAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="id" value={b.id} />
            <Field label="Message to the client (optional)" htmlFor="reason">
              <Textarea id="reason" name="reason" maxLength={500} className="min-h-16" />
            </Field>
            {b.status === "confirmed" && (b.payment_method === "stripe" || b.credits_used > 0) ? (
              <Checkbox name="refund" defaultChecked label={b.payment_method === "stripe" ? "Refund the card payment in full" : "Return the session credits"} />
            ) : null}
            <div>
              <SubmitButton variant="danger" pendingLabel="Cancelling…">
                Cancel booking
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
