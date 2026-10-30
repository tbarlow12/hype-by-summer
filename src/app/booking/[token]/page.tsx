import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, buttonClass, Card, CardTitle, Field, Textarea } from "@/components/ui";
import { ReschedulePicker } from "@/components/scheduling/reschedule-picker";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { requireBusiness } from "@/lib/tenant";
import { policyOf } from "@/lib/scheduling/availability";
import { formatDateTime, formatDuration, formatMoney } from "@/lib/format";
import { attendeeOf, googleCalendarLink, loadBookingContext, locationText } from "@/lib/scheduling/lifecycle";
import { canReschedule, decideCancellation, describePolicy } from "@/lib/scheduling/policy";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/scheduling/labels";
import { localDateOf } from "@/lib/scheduling/tz";
import { cancelByTokenAction, payByTokenAction, rescheduleByTokenAction } from "./actions";

export const metadata = { title: "Your booking", robots: { index: false } };

export default async function ManageBookingPage({ params, searchParams }: PageProps<"/booking/[token]">) {
  const { token } = await params;
  const { status: flash } = await searchParams;
  if (!/^[a-f0-9]{16,64}$/.test(token)) notFound();
  const business = await requireBusiness();
  const admin = createAdminClient();
  const { data: row } = await admin.from("bookings").select("id").eq("business_id", business.id).eq("manage_token", token).maybeSingle();
  const ctx = row ? await loadBookingContext(row.id) : null;
  if (!ctx) notFound();
  const { booking, sessionType, coach } = ctx;
  const policy = policyOf(business);
  const profile = await getProfile();
  const attendee = attendeeOf(ctx);
  const tz = profile?.timezone ?? attendee.timezone;
  const now = new Date();

  const cancelPreview = decideCancellation({
    booking: { ...booking, is_consultation: sessionType.is_consultation },
    policy,
    now,
    actor: "client",
  });
  const reschedule = canReschedule({ booking, policy, now, actor: "client" });
  const upcoming = Date.parse(booking.ends_at) > now.getTime();
  const active = booking.status === "confirmed" || booking.status === "pending_payment";

  let replacement: string | null = null;
  if (booking.cancel_reason === "rescheduled") {
    const { data } = await admin
      .from("bookings")
      .select("manage_token")
      .eq("business_id", business.id)
      .eq("rescheduled_from", booking.id)
      .maybeSingle();
    replacement = data?.manage_token ?? null;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {flash === "success" && booking.status === "pending_payment" ? (
        <Alert tone="amber">Thanks! We&apos;re confirming your payment. This page will show your confirmed booking in a moment; refresh if needed.</Alert>
      ) : null}
      {(flash === "success" || flash === "confirmed") && booking.status === "confirmed" ? (
        <Alert tone="green">You&apos;re booked! A confirmation email with a calendar invite is on its way{attendee.email ? ` to ${attendee.email}` : ""}.</Alert>
      ) : null}
      {flash === "rescheduled" && booking.status === "confirmed" ? <Alert tone="green">Your session was rescheduled. We sent an updated invite.</Alert> : null}
      {flash === "cancelled" ? <Alert tone="neutral">Checkout was cancelled. Your time is held for a few minutes if you&apos;d like to try again.</Alert> : null}
      {replacement ? (
        <Alert tone="neutral">
          This booking was rescheduled. <Link className="font-semibold underline" href={`/booking/${replacement}`}>View the new time</Link>.
        </Alert>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">{business.name}</p>
            <h1 className="text-2xl font-bold tracking-tight">{sessionType.name}</h1>
          </div>
          <Badge tone={STATUS_TONES[booking.status]}>{STATUS_LABELS[booking.status]}</Badge>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">When</dt>
            <dd className="font-medium">{formatDateTime(booking.starts_at, tz, "EEEE, MMMM d, yyyy")}</dd>
            <dd>
              {formatDateTime(booking.starts_at, tz, "h:mm a")} – {formatDateTime(booking.ends_at, tz, "h:mm a zzz")}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Where</dt>
            <dd className="font-medium break-words">{booking.location_type === "virtual" ? "Video call" : locationText(ctx)}</dd>
            <dd>{formatDuration(sessionType.duration_minutes)} with {coach.name}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Booked for</dt>
            <dd className="font-medium">{attendee.name}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Payment</dt>
            <dd className="font-medium">
              {booking.payment_method === "credits"
                ? `${booking.credits_used} credit${booking.credits_used === 1 ? "" : "s"}`
                : booking.payment_method === "free" || booking.price_cents === 0
                  ? "Free"
                  : booking.payment_method === "pay_later"
                    ? `${formatMoney(booking.price_cents, sessionType.currency)} due at the session`
                    : booking.status === "pending_payment"
                      ? `${formatMoney(booking.price_cents, sessionType.currency)} (awaiting payment)`
                      : `${formatMoney(booking.price_cents, sessionType.currency)} paid`}
            </dd>
          </div>
        </dl>

        {booking.status === "confirmed" && upcoming ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {booking.video_room_url ? (
              <a href={booking.video_room_url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                Join video call
              </a>
            ) : null}
            <a href={googleCalendarLink(ctx)} target="_blank" rel="noopener noreferrer" className={buttonClass("outline")}>
              Add to Google Calendar
            </a>
            <a href={`/booking/${booking.manage_token}/ics`} className={buttonClass("outline")}>
              Download .ics
            </a>
          </div>
        ) : null}
        {booking.status === "pending_payment" && booking.hold_expires_at ? (
          <p className="mt-4 text-sm text-zinc-500">
            Your spot is held until {formatDateTime(booking.hold_expires_at, tz, "h:mm a")}. Complete payment to confirm it.
          </p>
        ) : null}
        {booking.status === "pending_payment" && booking.hold_expires_at && new Date(booking.hold_expires_at) > new Date() ? (
          <ActionForm action={payByTokenAction} className="mt-3">
            <input type="hidden" name="token" value={booking.manage_token} />
            <SubmitButton pendingLabel="Opening checkout…">Complete payment</SubmitButton>
          </ActionForm>
        ) : null}
      </Card>

      {active && upcoming && booking.status === "confirmed" ? (
        <Card id="reschedule">
          <CardTitle>Reschedule</CardTitle>
          {reschedule.allowed ? (
            <div className="mt-4">
              <ReschedulePicker
                sessionSlug={sessionType.slug}
                coach={booking.coach_id}
                fallbackTimezone={tz}
                initialMonth={localDateOf(now, tz).slice(0, 7)}
                manageToken={booking.manage_token}
                hidden={{ token: booking.manage_token }}
                action={rescheduleByTokenAction}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">{reschedule.reason}</p>
          )}
        </Card>
      ) : null}

      {active && cancelPreview.allowed ? (
        <Card>
          <CardTitle>Cancel</CardTitle>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{cancelPreview.summary}</p>
          <ActionForm action={cancelByTokenAction} className="mt-4 flex flex-col gap-3">
            <input type="hidden" name="token" value={booking.manage_token} />
            <Field label="Reason (optional)" htmlFor="reason">
              <Textarea id="reason" name="reason" maxLength={500} className="min-h-16" />
            </Field>
            <div>
              <SubmitButton variant="danger" pendingLabel="Cancelling…">
                {cancelPreview.late ? "Cancel anyway (late)" : "Cancel booking"}
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <p className="text-center text-xs text-zinc-500">{describePolicy(policy)}</p>
      <p className="text-center text-sm">
        <Link href={`/book/${sessionType.slug}`} className="font-medium text-brand hover:underline">
          Book again
        </Link>
      </p>
    </div>
  );
}
