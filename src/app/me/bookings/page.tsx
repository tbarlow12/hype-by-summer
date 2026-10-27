import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, buttonClass, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, formatDuration } from "@/lib/format";
import { getTrainerSchedulingInfo } from "@/lib/scheduling/availability";
import { canReschedule, decideCancellation } from "@/lib/scheduling/policy";
import { LOCATION_LABELS, STATUS_LABELS, STATUS_TONES } from "@/lib/scheduling/labels";
import { cancelMyBookingAction } from "./actions";

export const metadata = { title: "My sessions" };

export default async function MyBookingsPage() {
  const profile = await requireClient();
  const supabase = await createClient();
  // Hide the superseded half of a reschedule (the new booking is listed instead).
  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("client_id", profile.id)
    .or("cancel_reason.is.null,cancel_reason.neq.rescheduled")
    .order("starts_at", { ascending: false })
    .limit(200);
  const all = bookings ?? [];

  const typeIds = [...new Set(all.map((b) => b.session_type_id))];
  const trainerIds = [...new Set(all.map((b) => b.trainer_id))];
  const [{ data: types }, trainers] = await Promise.all([
    typeIds.length
      ? createAdminClient().from("session_types").select("id, name, duration_minutes, is_consultation").in("id", typeIds)
      : Promise.resolve({ data: [] as { id: string; name: string; duration_minutes: number; is_consultation: boolean }[] }),
    Promise.all(trainerIds.map((id) => getTrainerSchedulingInfo(id))),
  ]);
  const typeById = new Map((types ?? []).map((t) => [t.id, t]));
  const trainerById = new Map(trainers.filter((t) => t !== null).map((t) => [t.trainer_id, t]));

  const now = new Date();
  const upcoming = all
    .filter((b) => Date.parse(b.ends_at) > now.getTime() && ["confirmed", "pending_payment"].includes(b.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = all.filter((b) => !upcoming.includes(b)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const tz = profile.timezone;

  return (
    <>
      <PageHeader title="My sessions" actions={<LinkButton href="/me/book">Book a session</LinkButton>} />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming sessions" description="Book your next session to keep the momentum going." action={<LinkButton href="/me/book">Book now</LinkButton>} />
        ) : (
          upcoming.map((b) => {
            const st = typeById.get(b.session_type_id);
            const trainer = trainerById.get(b.trainer_id);
            const cancel = trainer
              ? decideCancellation({ booking: { ...b, is_consultation: st?.is_consultation }, policy: trainer, now, actor: "client" })
              : null;
            const resched = trainer ? canReschedule({ booking: b, policy: trainer, now, actor: "client" }) : null;
            return (
              <Card key={b.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{st?.name ?? "Session"}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {formatDateTime(b.starts_at, tz, "EEEE, MMM d · h:mm a")} · {formatDuration(st?.duration_minutes ?? 60)}
                    </p>
                    <p className="text-sm text-zinc-500">{b.location_type === "in_person" ? (b.location_details ?? trainer?.default_location ?? "In person") : LOCATION_LABELS[b.location_type]}</p>
                  </div>
                  <Badge tone={STATUS_TONES[b.status]}>{STATUS_LABELS[b.status]}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {b.status === "confirmed" && b.video_room_url ? (
                    <a href={b.video_room_url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
                      Join video call
                    </a>
                  ) : null}
                  <Link href={`/booking/${b.manage_token}`} className={buttonClass("outline", "sm")}>
                    Details & calendar
                  </Link>
                  {resched?.allowed ? (
                    <Link href={`/booking/${b.manage_token}#reschedule`} className={buttonClass("outline", "sm")}>
                      Reschedule
                    </Link>
                  ) : null}
                </div>
                {cancel?.allowed ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-red-600">Cancel this session</summary>
                    <p className="mt-2 text-zinc-600 dark:text-zinc-400">{cancel.summary}</p>
                    <ActionForm action={cancelMyBookingAction} className="mt-2">
                      <input type="hidden" name="id" value={b.id} />
                      <SubmitButton variant="danger" size="sm" pendingLabel="Cancelling…">
                        {cancel.late ? "Cancel anyway (late)" : "Confirm cancellation"}
                      </SubmitButton>
                    </ActionForm>
                  </details>
                ) : null}
              </Card>
            );
          })
        )}
      </section>

      <section className="mt-8 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Past & cancelled</h2>
        {past.length === 0 ? (
          <EmptyState title="No past sessions yet" />
        ) : (
          <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
            {past.map((b) => (
              <Link key={b.id} href={`/booking/${b.manage_token}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <span>
                  <span className="font-medium">{typeById.get(b.session_type_id)?.name ?? "Session"}</span>
                  <span className="block text-zinc-500">{formatDateTime(b.starts_at, tz, "EEE, MMM d, yyyy · h:mm a")}</span>
                </span>
                <Badge tone={STATUS_TONES[b.status]}>{STATUS_LABELS[b.status]}</Badge>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </>
  );
}
