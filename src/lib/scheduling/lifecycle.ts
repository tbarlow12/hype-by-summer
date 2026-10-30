import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { sendSystemMessage } from "@/lib/messaging";
import { createVideoRoom } from "@/lib/video";
import { sendSms, smsTargetForBooking, type SmsKind } from "@/lib/sms";
import { refundBookingPayment, chargeBookingFee } from "@/lib/payments/refunds";
import { brandOf, businessUrl, getBusinessById, type Brand, type Business } from "@/lib/tenant";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getCoach, isClientOf, isSlotOffered, listCoaches, policyOf } from "./availability";
import { buildIcs, googleCalendarUrl } from "./ics";
import { bookingErrorMessage, canReschedule, decideCancellation } from "./policy";

// OWNER: scheduling. Booking lifecycle side effects: confirmation, cancel,
// reschedule, outcomes and waitlist notifications. Everything is branded
// with the booking's business and links to that business's site.

export type Booking = Tables<"bookings">;
type SessionType = Tables<"session_types">;
type ClientProfile = Pick<Tables<"profiles">, "id" | "email" | "full_name" | "timezone" | "phone">;
export type BookingCoach = { id: string; name: string; email: string | null; timezone: string };

export type BookingContext = {
  booking: Booking;
  sessionType: SessionType;
  business: Business;
  brand: Brand;
  /** The assigned coach (bookings.coach_id). */
  coach: BookingCoach;
  client: ClientProfile | null;
};

/** Who is acting: the client (signed in), a guest (manage link) or staff of the business. */
export type Actor = { kind: "client" | "guest" | "staff"; userId: string | null };

async function loadCoach(coachId: string, business: Business): Promise<BookingCoach> {
  const { data } = await createAdminClient().from("profiles").select("id, full_name, email, timezone").eq("id", coachId).maybeSingle();
  return {
    id: coachId,
    name: data?.full_name || business.name,
    email: data?.email ?? null,
    timezone: data?.timezone ?? business.timezone,
  };
}

export async function loadBookingContext(bookingId: string): Promise<BookingContext | null> {
  const admin = createAdminClient();
  const { data: booking } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!booking) return null;
  const [{ data: sessionType }, business, { data: client }] = await Promise.all([
    admin.from("session_types").select("*").eq("id", booking.session_type_id).eq("business_id", booking.business_id).single(),
    getBusinessById(booking.business_id),
    booking.client_id
      ? admin.from("profiles").select("id, email, full_name, timezone, phone").eq("id", booking.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!sessionType || !business) return null;
  const coach = await loadCoach(booking.coach_id, business);
  return { booking, sessionType, business, brand: brandOf(business), coach, client: client ?? null };
}

export function attendeeOf(ctx: Pick<BookingContext, "booking" | "client" | "coach">): { email: string | null; name: string; timezone: string } {
  return {
    email: ctx.client?.email ?? ctx.booking.guest_email,
    name: ctx.client?.full_name ?? ctx.booking.guest_name ?? ctx.client?.email ?? ctx.booking.guest_email ?? "Guest",
    timezone: ctx.client?.timezone ?? ctx.booking.client_timezone ?? ctx.coach.timezone,
  };
}

/** Human description of where the session happens. */
export function locationText(ctx: Pick<BookingContext, "booking" | "business" | "coach">): string {
  const { booking, business, coach } = ctx;
  switch (booking.location_type) {
    case "virtual":
      return booking.video_room_url ? `Video call: ${booking.video_room_url}` : "Video call (link to follow)";
    case "phone":
      return booking.location_details ?? `${coach.name} will call you`;
    case "client_location":
      return booking.location_details ? `At your location: ${booking.location_details}` : "At your location";
    default:
      return booking.location_details ?? business.default_location ?? "In person";
  }
}

/** Absolute manage link on the booking's business site. */
export function manageUrl(ctx: Pick<BookingContext, "booking" | "business">): string {
  return businessUrl(ctx.business, `/booking/${ctx.booking.manage_token}`);
}

/** Absolute public booking link for a session type on its business site. */
export function bookUrl(business: Business, sessionSlug?: string, query?: Record<string, string>): string {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  return businessUrl(business, `/book${sessionSlug ? `/${sessionSlug}` : ""}${qs}`);
}

export function bookingEventDetails(ctx: BookingContext) {
  const { booking, sessionType, coach } = ctx;
  const summary = `${sessionType.name} with ${coach.name}`;
  const description = [
    sessionType.description,
    booking.video_room_url ? `Join: ${booking.video_room_url}` : null,
    `Manage your booking: ${manageUrl(ctx)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const location = booking.location_type === "virtual" ? (booking.video_room_url ?? "Video call") : locationText(ctx);
  return { summary, description, location, start: booking.starts_at, end: booking.ends_at };
}

export function bookingIcs(ctx: BookingContext, opts: { cancelled?: boolean } = {}): string {
  const details = bookingEventDetails(ctx);
  const attendee = attendeeOf(ctx);
  const host = new URL(ctx.brand.siteUrl).hostname;
  return buildIcs({
    method: opts.cancelled ? "CANCEL" : "PUBLISH",
    prodId: `-//${ctx.brand.name.replace(/[/\r\n]/g, " ")}//Booking//EN`,
    events: [
      {
        uid: `${ctx.booking.id}@${host}`,
        ...details,
        url: manageUrl(ctx),
        status: opts.cancelled ? "CANCELLED" : "CONFIRMED",
        sequence: opts.cancelled ? 1 : 0,
        organizer: ctx.coach.email ? { name: ctx.coach.name, email: ctx.coach.email } : undefined,
        attendees: attendee.email ? [{ name: attendee.name, email: attendee.email }] : [],
        alarmMinutes: 60,
      },
    ],
  });
}

export function googleCalendarLink(ctx: BookingContext): string {
  return googleCalendarUrl(bookingEventDetails(ctx));
}

function icsAttachment(ctx: BookingContext, cancelled = false) {
  return {
    filename: cancelled ? "cancelled-session.ics" : "session.ics",
    content: bookingIcs(ctx, { cancelled }),
    contentType: `text/calendar; charset=utf-8; method=${cancelled ? "CANCEL" : "PUBLISH"}`,
  };
}

async function linkedClientId(ctx: BookingContext): Promise<string | null> {
  if (!ctx.booking.client_id) return null;
  return (await isClientOf(ctx.booking.client_id, ctx.booking.business_id)) ? ctx.booking.client_id : null;
}

async function safeSystemMessage(businessId: string, clientId: string | null, body: string) {
  if (!clientId) return;
  try {
    await sendSystemMessage({ businessId, clientId, body });
  } catch (err) {
    console.error("[scheduling] system message failed", err);
  }
}

/** Short SMS-friendly time, e.g. "Tue Oct 28 at 6:00 AM MDT" or "tomorrow (Tue) at 6:00 AM MDT". */
export function smsWhen(startsAt: string, timeZone: string, now = new Date()): string {
  const day = formatDateTime(startsAt, timeZone, "yyyy-MM-dd");
  const today = formatDateTime(now, timeZone, "yyyy-MM-dd");
  const tomorrow = formatDateTime(new Date(now.getTime() + 86_400_000), timeZone, "yyyy-MM-dd");
  const time = formatDateTime(startsAt, timeZone, "h:mm a zzz");
  if (day === today) return `today at ${time}`;
  if (day === tomorrow) return `tomorrow (${formatDateTime(startsAt, timeZone, "EEE")}) at ${time}`;
  return `${formatDateTime(startsAt, timeZone, "EEE MMM d")} at ${time}`;
}

/** Sends a booking SMS when the attendee consented (profile or booking opt-in). Never throws. */
export async function sendBookingSms(ctx: BookingContext, kind: SmsKind, lead: string): Promise<boolean> {
  try {
    const target = await smsTargetForBooking(ctx.booking.id);
    if (!target) return false;
    const when = smsWhen(ctx.booking.starts_at, attendeeOf(ctx).timezone);
    const parts = [`${lead}: ${ctx.sessionType.name} with ${ctx.coach.name} ${when}.`];
    if (kind !== "cancellation") {
      if (ctx.booking.location_type === "virtual" && ctx.booking.video_room_url) parts.push(`Join: ${ctx.booking.video_room_url}`);
      parts.push(`Manage: ${manageUrl(ctx)}`);
    } else {
      parts.push(`Rebook: ${bookUrl(ctx.business, ctx.sessionType.slug)}`);
    }
    const res = await sendSms({
      brand: ctx.brand,
      to: target.phone,
      body: parts.join(" "),
      kind,
      profileId: target.profileId,
      bookingId: ctx.booking.id,
    });
    return res.ok;
  } catch (err) {
    console.error("[scheduling] sms failed", err);
    return false;
  }
}

/**
 * Called once a booking becomes `confirmed` (free, credits, pay later, or after
 * Stripe payment). Creates the video room for virtual sessions and sends the
 * confirmation emails / notifications, branded with the booking's business,
 * to the attendee and the assigned coach. Idempotent: the side effects are
 * claimed through bookings.confirmation_sent_at.
 */
export async function onBookingConfirmed(bookingId: string): Promise<void> {
  const admin = createAdminClient();
  let ctx = await loadBookingContext(bookingId);
  if (!ctx || ctx.booking.status !== "confirmed" || ctx.booking.confirmation_sent_at) return;

  if (ctx.booking.location_type === "virtual" && !ctx.booking.video_room_url) {
    try {
      const url = await createVideoRoom({ bookingId, endsAt: ctx.booking.ends_at });
      await admin.from("bookings").update({ video_room_url: url }).eq("id", bookingId).is("video_room_url", null);
    } catch (err) {
      console.error("[scheduling] video room creation failed", err);
    }
  }

  // Claim the side effects; a concurrent / replayed call gets no row back.
  const { data: claimed } = await admin
    .from("bookings")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .is("confirmation_sent_at", null)
    .select("*")
    .maybeSingle();
  if (!claimed) return;
  ctx = { ...ctx, booking: claimed };

  const { booking, sessionType, coach, brand, business } = ctx;
  const attendee = attendeeOf(ctx);
  const rescheduled = Boolean(booking.rescheduled_from);
  const whenClient = `${formatDateTime(booking.starts_at, attendee.timezone, "EEEE, MMMM d 'at' h:mm a")} (${attendee.timezone.replace(/_/g, " ")})`;
  const whenCoach = formatDateTime(booking.starts_at, coach.timezone, "EEE, MMM d 'at' h:mm a");
  const where = locationText(ctx);

  if (attendee.email) {
    const paragraphs = [
      `Hi ${attendee.name.split(" ")[0]}, your ${sessionType.name} with ${coach.name} is ${rescheduled ? "rescheduled to" : "confirmed for"} ${whenClient}.`,
      `Duration: ${formatDuration(sessionType.duration_minutes)}\nWhere: ${where}`,
    ];
    if (booking.payment_method === "pay_later" && booking.price_cents > 0) paragraphs.push("Payment is due at the session.");
    if (booking.payment_method === "credits") paragraphs.push(`${booking.credits_used} session credit${booking.credits_used === 1 ? "" : "s"} used.`);
    paragraphs.push("Need to change plans? Use the button below to reschedule or cancel. A calendar invite is attached.");
    await sendEmail({
      brand,
      to: attendee.email,
      subject: `${rescheduled ? "Rescheduled" : "Booked"}: ${sessionType.name} on ${formatDateTime(booking.starts_at, attendee.timezone, "EEE, MMM d")}`,
      heading: rescheduled ? "Your session was rescheduled" : "You're booked!",
      paragraphs,
      cta: { label: "Manage booking", url: manageUrl(ctx) },
      attachments: [icsAttachment(ctx)],
    });
  }

  if (coach.email) {
    await sendEmail({
      brand,
      to: coach.email,
      subject: `${rescheduled ? "Rescheduled" : "New booking"}: ${attendee.name} · ${whenCoach}`,
      heading: rescheduled ? "A session was rescheduled" : "New booking",
      paragraphs: [
        `${attendee.name} booked ${sessionType.name} with you for ${whenCoach}.`,
        [
          attendee.email ? `Email: ${attendee.email}` : null,
          (booking.guest_phone ?? ctx.client?.phone) ? `Phone: ${booking.guest_phone ?? ctx.client?.phone}` : null,
          `Payment: ${booking.payment_method.replace("_", " ")}`,
          booking.client_notes ? `Notes: ${booking.client_notes}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      ],
      cta: { label: "Open in calendar", url: businessUrl(business, `/coach/calendar/${booking.id}`) },
      replyTo: attendee.email ?? undefined,
      attachments: [icsAttachment(ctx)],
    });
  }

  await notify({
    userId: coach.id,
    businessId: business.id,
    type: rescheduled ? "booking_rescheduled" : "booking_confirmed",
    title: `${rescheduled ? "Rescheduled" : "New booking"}: ${attendee.name}`,
    body: `${sessionType.name} · ${whenCoach}`,
    link: `/coach/calendar/${booking.id}`,
  });
  if (booking.client_id) {
    await notify({
      userId: booking.client_id,
      businessId: business.id,
      type: rescheduled ? "booking_rescheduled" : "booking_confirmed",
      title: rescheduled ? "Session rescheduled" : "Session booked",
      body: `${sessionType.name} with ${coach.name} · ${whenClient}`,
      link: "/me/bookings",
    });
  }
  await sendBookingSms(ctx, "confirmation", rescheduled ? "Rescheduled" : "Booked");
  await safeSystemMessage(
    business.id,
    await linkedClientId(ctx),
    `${rescheduled ? "Rescheduled" : "Booked"}: ${sessionType.name} with ${coach.name} on ${formatDateTime(booking.starts_at, business.timezone, "EEE, MMM d 'at' h:mm a")}`,
  );
}

export type CancelResult =
  | { ok: false; error: string }
  | { ok: true; message: string; late: boolean; refundedCents: number; creditsReturned: number; feeCharged: number; warnings: string[] };

/**
 * Cancel a booking under the business's policy. Clients/guests inside the
 * window get a late cancel (+ fee where applicable); staff choose refund or
 * not. Refunds go back to the card or the credit ledger.
 */
export async function cancelBooking(input: {
  bookingId: string;
  actor: Actor;
  reason?: string;
  staffRefund?: boolean;
  now?: Date;
}): Promise<CancelResult> {
  const admin = createAdminClient();
  const ctx = await loadBookingContext(input.bookingId);
  if (!ctx) return { ok: false, error: "Booking not found." };
  const { booking, sessionType, coach, brand, business } = ctx;
  const isStaff = input.actor.kind === "staff";
  const decision = decideCancellation({
    booking: { ...booking, is_consultation: sessionType.is_consultation },
    policy: policyOf(business),
    now: input.now ?? new Date(),
    actor: isStaff ? "coach" : "client",
    coachRefund: input.staffRefund,
  });
  if (!decision.allowed) return { ok: false, error: decision.reason };

  const { data: updated } = await admin
    .from("bookings")
    .update({
      status: decision.status,
      cancel_reason: input.reason?.slice(0, 500) ?? (isStaff ? "Cancelled by coach" : "Cancelled by client"),
      cancelled_at: new Date().toISOString(),
      cancelled_by: input.actor.userId,
      hold_expires_at: null,
    })
    .eq("id", booking.id)
    .in("status", ["confirmed", "pending_payment"])
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, error: "This booking was already changed. Refresh and try again." };

  const warnings: string[] = [];
  let refundedCents = 0;
  let creditsReturned = 0;
  let feeCharged = 0;
  if (decision.refundPayment) {
    try {
      refundedCents = (await refundBookingPayment(booking.id, { reason: "requested_by_customer" })).refundedCents;
    } catch (err) {
      console.error("[scheduling] refund failed", err);
      warnings.push("The refund could not be processed automatically. The coach will follow up.");
    }
  }
  if (decision.refundCredits) {
    const { data, error } = await admin.rpc("refund_booking_credits", { p_booking: booking.id });
    if (error) warnings.push("Session credits could not be returned automatically.");
    else creditsReturned = data ?? 0;
  }
  if (decision.chargeFee) {
    try {
      const res = await chargeBookingFee(booking.id, "late_cancel");
      if (res.ok) feeCharged = res.amountCents ?? decision.feeCents;
      else if (res.error) warnings.push(`Late fee not charged: ${res.error}`);
    } catch (err) {
      console.error("[scheduling] late fee failed", err);
      warnings.push("The late cancellation fee could not be charged automatically.");
    }
  }

  // Notify both sides (only for bookings that had been confirmed).
  if (booking.status === "confirmed") {
    const attendee = attendeeOf(ctx);
    const whenClient = formatDateTime(booking.starts_at, attendee.timezone, "EEEE, MMMM d 'at' h:mm a");
    const whenCoach = formatDateTime(booking.starts_at, coach.timezone, "EEE, MMM d 'at' h:mm a");
    const outcome = [
      decision.late ? "This was a late cancellation." : null,
      refundedCents > 0 ? `A refund of $${(refundedCents / 100).toFixed(2)} is on its way.` : null,
      creditsReturned > 0 ? `${creditsReturned} session credit${creditsReturned === 1 ? " was" : "s were"} returned to your account.` : null,
      feeCharged > 0 ? `A late cancellation fee of $${(feeCharged / 100).toFixed(2)} was charged.` : null,
    ].filter((x): x is string => Boolean(x));
    if (attendee.email) {
      await sendEmail({
        brand,
        to: attendee.email,
        subject: `Cancelled: ${sessionType.name} on ${formatDateTime(booking.starts_at, attendee.timezone, "EEE, MMM d")}`,
        heading: "Session cancelled",
        paragraphs: [
          isStaff
            ? `${brand.name} cancelled your ${sessionType.name} with ${coach.name} on ${whenClient}.${input.reason ? ` Reason: ${input.reason}` : ""}`
            : `Your ${sessionType.name} with ${coach.name} on ${whenClient} is cancelled.`,
          ...outcome,
        ],
        cta: { label: "Book another time", url: bookUrl(business, sessionType.slug) },
        attachments: [icsAttachment(ctx, true)],
      });
    }
    if (!isStaff) {
      if (coach.email) {
        await sendEmail({
          brand,
          to: coach.email,
          subject: `Cancelled: ${attendee.name} · ${whenCoach}`,
          heading: decision.late ? "Late cancellation" : "Booking cancelled",
          paragraphs: [
            `${attendee.name} cancelled ${sessionType.name} on ${whenCoach}.`,
            ...(input.reason ? [`Reason: ${input.reason}`] : []),
            ...outcome,
            ...warnings,
          ],
          cta: { label: "Open calendar", url: businessUrl(business, `/coach/calendar/${booking.id}`) },
        });
      }
      await notify({
        userId: coach.id,
        businessId: business.id,
        type: "booking_cancelled",
        title: `${decision.late ? "Late cancel" : "Cancelled"}: ${attendee.name}`,
        body: `${sessionType.name} · ${whenCoach}`,
        link: `/coach/calendar/${booking.id}`,
      });
    } else {
      await sendBookingSms(ctx, "cancellation", `${brand.name} cancelled`);
      if (input.actor.userId !== coach.id) {
        // Someone else (a manager / front desk) cancelled this coach's session.
        await notify({
          userId: coach.id,
          businessId: business.id,
          type: "booking_cancelled",
          title: `Cancelled: ${attendee.name}`,
          body: `${sessionType.name} · ${whenCoach}`,
          link: `/coach/calendar/${booking.id}`,
        });
      }
      if (booking.client_id) {
        await notify({
          userId: booking.client_id,
          businessId: business.id,
          type: "booking_cancelled",
          title: "Session cancelled by your coach",
          body: `${sessionType.name} · ${whenClient}`,
          link: "/me/bookings",
        });
      }
    }
    await safeSystemMessage(
      business.id,
      await linkedClientId(ctx),
      `Cancelled: ${sessionType.name} with ${coach.name} on ${formatDateTime(booking.starts_at, business.timezone, "EEE, MMM d 'at' h:mm a")}`,
    );
    await notifyWaitlist(sessionType.id, booking.coach_id, booking.starts_at);
  }

  const message = [
    decision.late ? "Cancelled (late cancellation)." : "Booking cancelled.",
    refundedCents > 0 ? `Refunded $${(refundedCents / 100).toFixed(2)}.` : null,
    creditsReturned > 0 ? `${creditsReturned} credit${creditsReturned === 1 ? "" : "s"} returned.` : null,
    feeCharged > 0 ? `Late fee of $${(feeCharged / 100).toFixed(2)} charged.` : null,
    ...warnings,
  ]
    .filter(Boolean)
    .join(" ");
  return { ok: true, message, late: decision.late, refundedCents, creditsReturned, feeCharged, warnings };
}

export type RescheduleResult = { ok: false; error: string } | { ok: true; booking: Booking };

/**
 * Moves a confirmed booking to a new time and/or another coach of the same
 * business. The reschedule_booking RPC reuses reserve_booking (with
 * p_rescheduled_from) and cancels the old row without refunds, carrying
 * payment and credits over.
 */
export async function rescheduleBooking(input: {
  bookingId: string;
  startsAt: string;
  /** Reassign to this coach (must run the session type); default: keep the coach. */
  coachId?: string | null;
  actor: Actor;
  /** Clients must pick an offered slot; staff may place it anywhere free. */
  requireOfferedSlot: boolean;
}): Promise<RescheduleResult> {
  const admin = createAdminClient();
  const ctx = await loadBookingContext(input.bookingId);
  if (!ctx) return { ok: false, error: "Booking not found." };
  const { booking, sessionType, business } = ctx;
  const isStaff = input.actor.kind === "staff";
  const check = canReschedule({ booking, policy: policyOf(business), now: new Date(), actor: isStaff ? "coach" : "client" });
  if (!check.allowed) return { ok: false, error: check.reason };
  if (Date.parse(input.startsAt) <= Date.now()) return { ok: false, error: "Pick a time in the future." };

  const coachId = input.coachId ?? booking.coach_id;
  if (coachId !== booking.coach_id) {
    if (!isStaff) return { ok: false, error: "Message us to change coaches." };
    const coach = await getCoach(business.id, coachId);
    if (!coach || !sessionType.coach_ids.includes(coachId)) return { ok: false, error: "That coach doesn't run this session type." };
  }

  if (input.requireOfferedSlot) {
    const offer = await isSlotOffered({
      businessId: business.id,
      sessionType,
      coaches: await listCoaches(business.id, { bookableOnly: true }),
      coachId,
      startsAt: input.startsAt,
      excludeBookingId: booking.id,
    });
    if (!offer.offered) return { ok: false, error: bookingErrorMessage(offer.full ? "slot_full" : "slot_unavailable") };
  }

  const { data, error } = await admin.rpc("reschedule_booking", {
    p_booking: booking.id,
    p_starts_at: new Date(input.startsAt).toISOString(),
    p_actor: input.actor.userId ?? undefined,
    p_coach_id: coachId,
  });
  if (error || !data) return { ok: false, error: bookingErrorMessage(error?.message) };

  if (coachId !== booking.coach_id) {
    const attendee = attendeeOf(ctx);
    await notify({
      userId: booking.coach_id,
      businessId: business.id,
      type: "booking_reassigned",
      title: `Reassigned: ${attendee.name}`,
      body: `${sessionType.name} · ${formatDateTime(booking.starts_at, ctx.coach.timezone, "EEE, MMM d 'at' h:mm a")} moved to another coach`,
      link: `/coach/calendar/${data.id}`,
    });
  }
  try {
    await onBookingConfirmed(data.id);
  } catch (err) {
    console.error("[scheduling] confirmation after reschedule failed", err);
  }
  await notifyWaitlist(sessionType.id, booking.coach_id, booking.starts_at);
  return { ok: true, booking: data };
}

/** Staff marks a past session as completed or no-show (optionally charging the no-show fee). */
export async function markBookingOutcome(input: {
  bookingId: string;
  businessId: string;
  status: "completed" | "no_show" | "confirmed";
  chargeNoShowFee?: boolean;
}): Promise<{ ok: boolean; error?: string; message?: string }> {
  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status, starts_at")
    .eq("id", input.bookingId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!booking) return { ok: false, error: "Booking not found." };
  if (!["confirmed", "completed", "no_show"].includes(booking.status)) {
    return { ok: false, error: "Only confirmed sessions can be marked." };
  }
  if (input.status !== "confirmed" && Date.parse(booking.starts_at) > Date.now()) {
    return { ok: false, error: "You can mark the outcome once the session has started." };
  }
  const { error } = await admin.from("bookings").update({ status: input.status }).eq("id", booking.id).eq("business_id", input.businessId);
  if (error) return { ok: false, error: error.message };
  if (input.status === "no_show" && input.chargeNoShowFee) {
    try {
      const res = await chargeBookingFee(booking.id, "no_show");
      if (!res.ok) return { ok: true, message: `Marked as no-show. Fee not charged: ${res.error ?? "unknown error"}` };
      return { ok: true, message: `Marked as no-show and charged $${((res.amountCents ?? 0) / 100).toFixed(2)}.` };
    } catch (err) {
      console.error("[scheduling] no-show fee failed", err);
      return { ok: true, message: "Marked as no-show. The fee could not be charged." };
    }
  }
  return { ok: true, message: input.status === "completed" ? "Marked as completed." : input.status === "no_show" ? "Marked as no-show." : "Status reset to confirmed." };
}

/** Active seats taken in one coach's (group) session. */
export async function seatsTaken(sessionTypeId: string, coachId: string, startsAt: string): Promise<number> {
  const { data } = await createAdminClient()
    .from("bookings")
    .select("status, hold_expires_at")
    .eq("session_type_id", sessionTypeId)
    .eq("coach_id", coachId)
    .eq("starts_at", new Date(startsAt).toISOString())
    .in("status", ["confirmed", "completed", "no_show", "pending_payment"]);
  const now = Date.now();
  return (data ?? []).filter((b) => b.status !== "pending_payment" || (b.hold_expires_at && Date.parse(b.hold_expires_at) > now)).length;
}

/** Email waitlisted people when a seat opens in a coach's session. Returns how many were notified. */
export async function notifyWaitlist(sessionTypeId: string, coachId: string, startsAt: string): Promise<number> {
  const admin = createAdminClient();
  if (Date.parse(startsAt) <= Date.now()) return 0;
  const { data: entries } = await admin
    .from("waitlist_entries")
    .select("id, email, name, client_id")
    .eq("session_type_id", sessionTypeId)
    .eq("coach_id", coachId)
    .eq("starts_at", new Date(startsAt).toISOString())
    .is("notified_at", null)
    .order("created_at");
  if (!entries?.length) return 0;
  const { data: st } = await admin.from("session_types").select("*").eq("id", sessionTypeId).maybeSingle();
  if (!st || !st.active) return 0;
  const open = st.capacity - (await seatsTaken(sessionTypeId, coachId, startsAt));
  if (open <= 0) return 0;
  const business = await getBusinessById(st.business_id);
  if (!business) return 0;
  const brand = brandOf(business);
  const coach = await loadCoach(coachId, business);

  // Everyone waiting hears about it; first to book gets the seat.
  let sent = 0;
  for (const entry of entries) {
    const { data: claimed } = await admin
      .from("waitlist_entries")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", entry.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    let tz = coach.timezone;
    if (entry.client_id) {
      const { data: p } = await admin.from("profiles").select("timezone").eq("id", entry.client_id).maybeSingle();
      tz = p?.timezone ?? tz;
    }
    const when = `${formatDateTime(startsAt, tz, "EEEE, MMMM d 'at' h:mm a")} (${tz.replace(/_/g, " ")})`;
    const url = bookUrl(business, st.slug, { date: new Date(startsAt).toISOString(), coach: coachId });
    await sendEmail({
      brand,
      to: entry.email,
      subject: `A spot opened up: ${st.name}`,
      heading: "A spot just opened up",
      paragraphs: [
        `Good news${entry.name ? `, ${entry.name.split(" ")[0]}` : ""}! A spot opened in ${st.name} with ${coach.name} on ${when}.`,
        "Spots go to whoever books first, so grab it while it's there.",
      ],
      cta: { label: "Book the spot", url },
    });
    if (entry.client_id) {
      await notify({
        userId: entry.client_id,
        businessId: business.id,
        type: "waitlist_open",
        title: `Spot open: ${st.name}`,
        body: when,
        link: `/me/book?${new URLSearchParams({ session: st.slug, coach: coachId, date: new Date(startsAt).toISOString() })}`,
      });
    }
    sent += 1;
  }
  return sent;
}
