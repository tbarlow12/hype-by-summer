import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { formatDateTime, formatDuration } from "@/lib/format";
import { attendeeOf, loadBookingContext, locationText, manageUrl, notifyWaitlist, sendBookingSms, trainerName } from "./lifecycle";
import { dueReminder } from "./policy";

// Cron work for scheduling (GET /api/cron/reminders every 15 minutes).

export type CronReport = {
  holdsExpired: number;
  remindersSent: number;
  smsSent: number;
  waitlistNotified: number;
  autoCompleted: number;
  errors: string[];
};

function reminderLabel(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? "tomorrow" : `in ${hours / 24} days`;
  return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
}

async function sendReminders(report: CronReport, now: Date) {
  const admin = createAdminClient();
  const { data: trainers } = await admin.from("trainer_profiles").select("trainer_id, reminder_hours");
  for (const t of trainers ?? []) {
    const hours = (t.reminder_hours ?? []).filter((h) => h > 0);
    if (!hours.length) continue;
    const horizon = new Date(now.getTime() + Math.max(...hours) * 3_600_000).toISOString();
    const { data: bookings } = await admin
      .from("bookings")
      .select("id, starts_at, created_at, reminders_sent")
      .eq("trainer_id", t.trainer_id)
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
            to: attendee.email,
            subject: `Reminder: ${ctx.sessionType.name} ${reminderLabel(due.send)}`,
            heading: `See you ${reminderLabel(due.send)}`,
            paragraphs: [
              `Your ${ctx.sessionType.name} with ${trainerName(ctx.trainer)} is on ${when}.`,
              `Duration: ${formatDuration(ctx.sessionType.duration_minutes)}\nWhere: ${locationText(ctx)}`,
            ],
            cta: ctx.booking.video_room_url
              ? { label: "Join video call", url: ctx.booking.video_room_url }
              : { label: "Manage booking", url: manageUrl(ctx.booking) },
            footerNote: `Need to change plans? ${manageUrl(ctx.booking)}`,
            replyTo: ctx.trainer.email,
          });
        }
        if (ctx.booking.client_id) {
          await notify({
            userId: ctx.booking.client_id,
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
}

async function processWaitlist(report: CronReport, now: Date) {
  const admin = createAdminClient();
  const { data: entries } = await admin
    .from("waitlist_entries")
    .select("session_type_id, starts_at")
    .is("notified_at", null)
    .gt("starts_at", now.toISOString())
    .limit(1000);
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const key = `${e.session_type_id}|${e.starts_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      report.waitlistNotified += await notifyWaitlist(e.session_type_id, e.starts_at);
    } catch (err) {
      report.errors.push(`waitlist ${key}: ${String(err)}`);
    }
  }
}

export async function runSchedulingCron(now = new Date()): Promise<CronReport> {
  const admin = createAdminClient();
  const report: CronReport = { holdsExpired: 0, remindersSent: 0, smsSent: 0, waitlistNotified: 0, autoCompleted: 0, errors: [] };

  const { data: expired, error: holdError } = await admin.rpc("expire_booking_holds");
  if (holdError) report.errors.push(`expire_booking_holds: ${holdError.message}`);
  else report.holdsExpired = expired ?? 0;

  await sendReminders(report, now);
  await processWaitlist(report, now);

  const cutoff = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data: completed, error: completeError } = await admin
    .from("bookings")
    .update({ status: "completed" })
    .eq("status", "confirmed")
    .lt("ends_at", cutoff)
    .select("id");
  if (completeError) report.errors.push(`auto-complete: ${completeError.message}`);
  else report.autoCompleted = completed?.length ?? 0;

  return report;
}
