import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, Card, CardTitle, Checkbox, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { localDateOf } from "@/lib/scheduling/tz";
import { WeeklyHoursEditor } from "./weekly-hours-editor";
import { TimezoneForm } from "./timezone-form";
import { addOverrideAction, deleteOverrideAction, saveTimezoneAction, saveWeeklyHoursAction } from "./actions";

export const metadata = { title: "Availability" };

export default async function AvailabilityPage() {
  const profile = await requireTrainer();
  const supabase = await createClient();
  const tz = profile.timezone;
  const [{ data: rules }, { data: overrides }, { data: types }] = await Promise.all([
    supabase.from("availability_rules").select("*").eq("trainer_id", profile.id).order("weekday").order("start_time"),
    supabase
      .from("availability_overrides")
      .select("*")
      .eq("trainer_id", profile.id)
      .gt("ends_at", new Date().toISOString())
      .order("starts_at"),
    supabase.from("session_types").select("id, name").eq("trainer_id", profile.id).order("sort_order"),
  ]);
  const today = localDateOf(new Date(), tz);

  const describe = (o: { starts_at: string; ends_at: string }) => {
    const startDay = formatDateTime(o.starts_at, tz, "EEE, MMM d");
    const endInstant = new Date(Date.parse(o.ends_at) - 1);
    const endDay = formatDateTime(endInstant, tz, "EEE, MMM d");
    const startTime = formatDateTime(o.starts_at, tz, "h:mm a");
    const endTime = formatDateTime(o.ends_at, tz, "h:mm a");
    const allDay = startTime === "12:00 AM" && endTime === "12:00 AM";
    if (allDay) return startDay === endDay ? `${startDay} · all day` : `${startDay} – ${endDay} · all day`;
    return startDay === endDay ? `${startDay} · ${startTime} – ${endTime}` : `${startDay} ${startTime} – ${endDay} ${endTime}`;
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Availability" description={`When clients can book you. Times are in ${tz.replace(/_/g, " ")}.`} />

      <Card>
        <CardTitle>Weekly hours</CardTitle>
        <p className="mb-2 mt-1 text-sm text-zinc-500">Add one or more ranges per day. Bookings, buffers and time off are subtracted automatically.</p>
        <WeeklyHoursEditor
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
        <ActionForm action={addOverrideAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue="off">
              <option value="off">Time off (block)</option>
              <option value="extra">Extra hours (open)</option>
            </Select>
          </Field>
          <Field label="Reason (optional)" htmlFor="reason">
            <Input id="reason" name="reason" maxLength={200} placeholder="Vacation, workshop…" />
          </Field>
          <Field label="From date" htmlFor="start_date">
            <Input id="start_date" name="start_date" type="date" min={today} defaultValue={today} required />
          </Field>
          <Field label="To date" htmlFor="end_date" hint="Leave empty for a single day">
            <Input id="end_date" name="end_date" type="date" min={today} />
          </Field>
          <Field label="Start time" htmlFor="start_time" hint="Ignored for all-day">
            <Input id="start_time" name="start_time" type="time" />
          </Field>
          <Field label="End time" htmlFor="end_time">
            <Input id="end_time" name="end_time" type="time" />
          </Field>
          <Checkbox name="all_day" label="All day" defaultChecked className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <SubmitButton>Add</SubmitButton>
          </div>
        </ActionForm>

        {(overrides ?? []).length === 0 ? (
          <EmptyState title="No upcoming time off or extra hours" description="Block out vacations or open extra slots for a specific day." />
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {(overrides ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={o.is_available ? "green" : "amber"}>{o.is_available ? "Extra hours" : "Time off"}</Badge>
                  <span className="font-medium">{describe(o)}</span>
                  {o.reason ? <span className="text-zinc-500">· {o.reason}</span> : null}
                </div>
                <form action={deleteOverrideAction}>
                  <input type="hidden" name="id" value={o.id} />
                  <Button type="submit" variant="ghost" size="sm" aria-label="Remove">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>Timezone</CardTitle>
        <p className="mb-3 mt-1 text-sm text-zinc-500">Weekly hours are interpreted in this timezone, including daylight saving changes.</p>
        <TimezoneForm value={tz} action={saveTimezoneAction} />
      </Card>
    </div>
  );
}
