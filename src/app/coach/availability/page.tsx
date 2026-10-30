import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, Card, CardTitle, Checkbox, cn, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { listCoaches } from "@/lib/scheduling/availability";
import { localDateOf } from "@/lib/scheduling/tz";
import type { Tables } from "@/lib/supabase/database.types";
import { WeeklyHoursEditor } from "./weekly-hours-editor";
import { TimezoneForm } from "./timezone-form";
import { addOverrideAction, deleteOverrideAction, saveTimezoneAction, saveWeeklyHoursAction } from "./actions";

export const metadata = { title: "Availability" };

type Override = Tables<"availability_overrides">;

/**
 * Weekly hours, time off and timezone for one coach (yourself by default;
 * managers can pick anyone on the team) plus business-wide closures.
 */
export default async function AvailabilityPage({ searchParams }: PageProps<"/coach/availability">) {
  const { profile, business, membership } = await requireStaff();
  const manager = isManager(membership);
  const { coach: requested } = await searchParams;
  const team = await listCoaches(business.id);
  const coach =
    (manager && typeof requested === "string" ? team.find((c) => c.id === requested) : undefined) ??
    team.find((c) => c.id === profile.id) ??
    team[0]!;
  const self = coach.id === profile.id;
  const tz = coach.timezone;

  const supabase = await createClient();
  const now = new Date().toISOString();
  const [{ data: rules }, { data: overrides }, { data: closures }, { data: types }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("business_id", business.id).eq("coach_id", coach.id).order("weekday").order("start_time"),
    supabase
      .from("availability_overrides")
      .select("*")
      .eq("business_id", business.id)
      .eq("coach_id", coach.id)
      .gt("ends_at", now)
      .order("starts_at"),
    supabase
      .from("availability_overrides")
      .select("*")
      .eq("business_id", business.id)
      .is("coach_id", null)
      .gt("ends_at", now)
      .order("starts_at"),
    supabase.from("session_types").select("id, name").eq("business_id", business.id).contains("coach_ids", [coach.id]).order("sort_order"),
  ]);
  const today = localDateOf(new Date(), tz);

  const describe = (o: { starts_at: string; ends_at: string }, zone: string) => {
    const startDay = formatDateTime(o.starts_at, zone, "EEE, MMM d");
    const endInstant = new Date(Date.parse(o.ends_at) - 1);
    const endDay = formatDateTime(endInstant, zone, "EEE, MMM d");
    const startTime = formatDateTime(o.starts_at, zone, "h:mm a");
    const endTime = formatDateTime(o.ends_at, zone, "h:mm a");
    const allDay = startTime === "12:00 AM" && endTime === "12:00 AM";
    if (allDay) return startDay === endDay ? `${startDay} · all day` : `${startDay} – ${endDay} · all day`;
    return startDay === endDay ? `${startDay} · ${startTime} – ${endTime}` : `${startDay} ${startTime} – ${endDay} ${endTime}`;
  };

  const overrideList = (list: Override[], zone: string, canDelete: boolean, empty: { title: string; description: string }) =>
    list.length === 0 ? (
      <EmptyState title={empty.title} description={empty.description} />
    ) : (
      <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {list.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={o.is_available ? "green" : "amber"}>{o.coach_id === null ? "Closed" : o.is_available ? "Extra hours" : "Time off"}</Badge>
              <span className="font-medium">{describe(o, zone)}</span>
              {o.reason ? <span className="text-zinc-500">· {o.reason}</span> : null}
            </div>
            {canDelete ? (
              <form action={deleteOverrideAction}>
                <input type="hidden" name="id" value={o.id} />
                <Button type="submit" variant="ghost" size="sm" aria-label="Remove">
                  Remove
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    );

  const overrideForm = (targetId: string, closure: boolean, zone: string) => (
    <ActionForm action={addOverrideAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="coach_id" value={targetId} />
      {closure ? (
        <input type="hidden" name="kind" value="off" />
      ) : (
        <Field label="Type" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="off">
            <option value="off">Time off (block)</option>
            <option value="extra">Extra hours (open)</option>
          </Select>
        </Field>
      )}
      <Field label="Reason (optional)" htmlFor={`reason-${targetId}`} className={closure ? "sm:col-span-2" : undefined}>
        <Input id={`reason-${targetId}`} name="reason" maxLength={200} placeholder={closure ? "Holiday, gym closed…" : "Vacation, workshop…"} />
      </Field>
      <Field label="From date" htmlFor={`start_date-${targetId}`}>
        <Input id={`start_date-${targetId}`} name="start_date" type="date" min={localDateOf(new Date(), zone)} defaultValue={localDateOf(new Date(), zone)} required />
      </Field>
      <Field label="To date" htmlFor={`end_date-${targetId}`} hint="Leave empty for a single day">
        <Input id={`end_date-${targetId}`} name="end_date" type="date" min={localDateOf(new Date(), zone)} />
      </Field>
      <Field label="Start time" htmlFor={`start_time-${targetId}`} hint="Ignored for all-day">
        <Input id={`start_time-${targetId}`} name="start_time" type="time" />
      </Field>
      <Field label="End time" htmlFor={`end_time-${targetId}`}>
        <Input id={`end_time-${targetId}`} name="end_time" type="time" />
      </Field>
      <Checkbox name="all_day" label="All day" defaultChecked className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton>{closure ? "Add closure" : "Add"}</SubmitButton>
      </div>
    </ActionForm>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Availability"
        description={`When clients can book ${self ? "you" : coach.name}. Times are in ${tz.replace(/_/g, " ")}.`}
      />

      {manager && team.length > 1 ? (
        <nav aria-label="Coach" className="flex flex-wrap gap-2">
          {team.map((c) => (
            <Link
              key={c.id}
              href={c.id === profile.id ? "/coach/availability" : `/coach/availability?coach=${c.id}`}
              aria-current={c.id === coach.id ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                c.id === coach.id
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800",
              )}
            >
              {c.id === profile.id ? `${c.name} (you)` : c.name}
              {!c.isBookable ? " · not bookable" : ""}
            </Link>
          ))}
        </nav>
      ) : null}

      {!coach.isBookable ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {self ? "You're" : `${coach.name} is`} not bookable right now, so these hours aren&apos;t offered to clients.
        </p>
      ) : null}

      <Card>
        <CardTitle>Weekly hours</CardTitle>
        <p className="mb-2 mt-1 text-sm text-zinc-500">Add one or more ranges per day. Bookings, buffers, time off and closures are subtracted automatically.</p>
        <WeeklyHoursEditor
          key={coach.id}
          coachId={coach.id}
          initial={(rules ?? []).map((r) => ({
            weekday: r.weekday,
            start: r.start_time.slice(0, 5),
            end: r.end_time.startsWith("24") ? "24:00" : r.end_time.slice(0, 5),
            types: r.session_type_ids ?? [],
          }))}
          sessionTypes={types ?? []}
          action={saveWeeklyHoursAction}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Time off & extra hours</CardTitle>
        {overrideForm(coach.id, false, tz)}
        {overrideList(overrides ?? [], tz, true, {
          title: "No upcoming time off or extra hours",
          description: "Block out vacations or open extra slots for a specific day.",
        })}
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Business closures</CardTitle>
        <p className="-mt-2 text-sm text-zinc-500">
          Holidays and closures block every coach. Times are in the business timezone ({business.timezone.replace(/_/g, " ")}).
        </p>
        {manager ? overrideForm("business", true, business.timezone) : null}
        {overrideList(closures ?? [], business.timezone, manager, {
          title: "No upcoming closures",
          description: manager ? "Add holidays or days the business is closed." : "Managers add holidays and closures here.",
        })}
      </Card>

      <Card>
        <CardTitle>Timezone</CardTitle>
        <p className="mb-3 mt-1 text-sm text-zinc-500">Weekly hours are interpreted in this timezone, including daylight saving changes.</p>
        <TimezoneForm key={coach.id} coachId={coach.id} value={tz} label={self ? "Your timezone" : `${coach.name}'s timezone`} action={saveTimezoneAction} />
      </Card>
    </div>
  );
}
