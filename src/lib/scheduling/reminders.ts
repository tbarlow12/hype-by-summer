import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { formatDateTime, formatDuration } from "@/lib/format";
import { attendeeOf, loadBookingContext, locationText, manageUrl, notifyWaitlist, sendBookingSms } from "./lifecycle";
import { dueReminder } from "./policy";

// Cron work for scheduling (GET /api/cron/reminders every 15 minutes). There
// is no request host here: every business is processed by id, and emails/SMS
// are branded with and link to the booking's own business.

export type CronReport = {
  businesses: number;
  holdsExpired: number;
  remindersSent: number;
  smsSent: number;
  waitlistNotified: number;
  autoCompleted: number;
  errors: string[];
};

type CronBusiness = { id: string; reminder_hours: number[] };

export function reminderLabel(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? "tomorrow" : `in ${hours / 24} days`;
  return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
}

async function sendReminders(business: CronBusiness, report: CronReport, now: Date) {
  const admin = createAdminClient();
  const hours = (business.reminder_hours ?? []).filter((h) => h > 0);
  if (!hours.length) return;
  const horizon = new Date(now.getTime() + Math.max(...hours) * 3_600_000).toISOString();
  const { data: bookings } = await admin
    .from("bookings")
    .select("id, starts_at, created_at, reminders_sent")
    .eq("business_id", business.id)
    .eq("status", "confirmed")
    .gt("starts_at", now.toISOString())
    .lte("starts_at", horizon)
    .limit(500);
  for (const b of bookings ?? []) {
    const due = dueReminder({ starts_at: b.starts_at, created_at: b.created_at, reminders_sent: b.reminders_sent, reminderHours: hours, now });
    if (!due.mark.length) continue;
    // Claim first (optimistic on reminders_sent) so overlapping runs never double-send.
    const { data: claimed } = await admin
      .from("bookings")
      .update({ reminders_sent: [...new Set([...b.reminders_sent, ...due.mark])] })
      .eq("id", b.id)
      .filter("reminders_sent", "eq", `{${b.reminders_sent.join(",")}}`)
      .select("id")
      .maybeSingle();
    if (!claimed || due.send === null) continue;
    try {
      const ctx = await loadBookingContext(b.id);
      if (!ctx) continue;
      const attendee = attendeeOf(ctx);
      const when = `${formatDateTime(b.starts_at, attendee.timezone, "EEEE, MMMM d 'at' h:mm a")} (${attendee.timezone.replace(/_/g, " ")})`;
      if (attendee.email) {
        await sendEmail({
          brand: ctx.brand,
          to: attendee.email,
          subject: `Reminder: ${ctx.sessionType.name} ${reminderLabel(due.send)}`,
          heading: `See you ${reminderLabel(due.send)}`,
          paragraphs: [
            `Your ${ctx.sessionType.name} with ${ctx.coach.name} is on ${when}.`,
            `Duration: ${formatDuration(ctx.sessionType.duration_minutes)}\nWhere: ${locationText(ctx)}`,
          ],
          cta: ctx.booking.video_room_url
            ? { label: "Join video call", url: ctx.booking.video_room_url }
            : { label: "Manage booking", url: manageUrl(ctx) },
          footerNote: `Need to change plans? ${manageUrl(ctx)}`,
        });
      }
      if (ctx.booking.client_id) {
        await notify({
          userId: ctx.booking.client_id,
          businessId: ctx.business.id,
          type: "booking_reminder",
          title: `Reminder: ${ctx.sessionType.name} ${reminderLabel(due.send)}`,
          body: when,
          link: "/me/bookings",
        });
      }
      if (await sendBookingSms(ctx, "reminder", "Reminder")) report.smsSent += 1;
      report.remindersSent += 1;
    } catch (err) {
      report.errors.push(`reminder ${b.id}: ${String(err)}`);
    }
  }
}

async function processWaitlist(business: CronBusiness, report: CronReport, now: Date) {
  const { data: entries } = await createAdminClient()
    .from("waitlist_entries")
    .select("session_type_id, coach_id, starts_at")
    .eq("business_id", business.id)
    .is("notified_at", null)
    .gt("starts_at", now.toISOString())
    .limit(1000);
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const key = `${e.session_type_id}|${e.coach_id}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      report.waitlistNotified += await notifyWaitlist(e.session_type_id, e.coach_id, e.starts_at);
    } catch (err) {
      report.errors.push(`waitlist ${key}: ${String(err)}`);
    }
  }
}

async function autoComplete(business: CronBusiness, report: CronReport, now: Date) {
  const cutoff = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data, error } = await createAdminClient()
    .from("bookings")
    .update({ status: "completed" })
    .eq("business_id", business.id)
    .eq("status", "confirmed")
    .lt("ends_at", cutoff)
    .select("id");
  if (error) report.errors.push(`auto-complete ${business.id}: ${error.message}`);
  else report.autoCompleted += data?.length ?? 0;
}

export async function runSchedulingCron(now = new Date()): Promise<CronReport> {
  const admin = createAdminClient();
  const report: CronReport = { businesses: 0, holdsExpired: 0, remindersSent: 0, smsSent: 0, waitlistNotified: 0, autoCompleted: 0, errors: [] };

  // Unpaid holds expire the same way at every business (one sweep).
  const { data: expired, error: holdError } = await admin.rpc("expire_booking_holds");
  if (holdError) report.errors.push(`expire_booking_holds: ${holdError.message}`);
  else report.holdsExpired = expired ?? 0;

  const { data: businesses, error } = await admin.from("businesses").select("id, reminder_hours").eq("status", "active");
  if (error) report.errors.push(`businesses: ${error.message}`);
  for (const business of businesses ?? []) {
    report.businesses += 1;
    // One business failing never stops the others.
    for (const step of [sendReminders, processWaitlist, autoComplete]) {
      try {
        await step(business, report, now);
      } catch (err) {
        report.errors.push(`${step.name} ${business.id}: ${String(err)}`);
      }
    }
  }
  return report;
}
