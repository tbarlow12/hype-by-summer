import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, Card, CardTitle, Checkbox, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ConfirmSubmit } from "@/components/training/confirm-submit";
import { AdherenceBars, FlagBadges, ProgramFeedbackItem, WorkoutLogItem } from "@/components/training/feedback";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { adherenceByWeek, feedbackFlags, adherenceToDate } from "@/lib/training/adherence";
import { respondToProgramFeedback, respondToWorkoutLog } from "@/lib/training/coach-actions";
import { longDateLabel, programPosition, todayInTz } from "@/lib/training/dates";
import { EXERCISE_FIELDS, exerciseLibraryFilter, loadLogs, loadProgramTree, loadRoster, loadStaff } from "@/lib/training/server";
import { assignProgram, deleteProgram, duplicateProgram, setProgramCoach, setProgramStatus, updateProgramMeta } from "../actions";
import { ProgramBuilder } from "./program-builder";

export const metadata = { title: "Program builder" };

const STATUS_TONE = { draft: "neutral", active: "green", completed: "blue", archived: "neutral" } as const;

export default async function ProgramPage({ params, searchParams }: PageProps<"/coach/programs/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { profile, business } = await requireStaff();
  const supabase = await createClient();
  const tree = await loadProgramTree(supabase, business.id, id);
  if (!tree) notFound();
  const { program, workouts } = tree;
  const isTemplate = !program.client_id;
  const today = todayInTz(profile.timezone);

  const [{ data: library }, clientRes, rosterRes, logs, feedbackRes, staff] = await Promise.all([
    supabase
      .from("exercises")
      .select(EXERCISE_FIELDS)
      .or(exerciseLibraryFilter(business.id))
      .order("name")
      .limit(1000),
    program.client_id
      ? supabase.from("profiles").select("id, full_name, email, timezone").eq("id", program.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    isTemplate ? loadRoster(supabase, business.id) : Promise.resolve([]),
    program.client_id
      ? loadLogs(supabase, { businessId: business.id, clientId: program.client_id, programId: program.id, limit: 30 })
      : Promise.resolve([]),
    program.client_id
      ? supabase
          .from("program_feedback")
          .select("*, responder:profiles!program_feedback_responded_by_fkey(full_name)")
          .eq("business_id", business.id)
          .eq("program_id", program.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    loadStaff(business.id),
  ]);
  const client = clientRes.data;
  const roster = rosterRes.sort((a, b) => displayName(a.client).localeCompare(displayName(b.client)));
  const coach = program.coach_id ? staff.find((m) => m.user_id === program.coach_id) : null;
  const feedback = feedbackRes.data ?? [];

  const position = program.start_date ? programPosition(program.start_date, program.duration_weeks, today) : null;
  const currentWeek = position?.week ?? (program.start_date && program.start_date < today ? program.duration_weeks : null);
  const weeks = adherenceByWeek(workouts, logs.map((l) => l.workout_id), program.duration_weeks);
  const overall = currentWeek
    ? adherenceToDate(workouts, logs.map((l) => l.workout_id), position ?? { week: currentWeek, day: 7 })
    : null;
  const flags = feedbackFlags(logs);

  const statusButtons = isTemplate
    ? [
        program.status === "draft" ? { s: "active", label: "Publish" } : null,
        program.status !== "archived" ? { s: "archived", label: "Archive" } : { s: "draft", label: "Restore" },
      ]
    : [
        program.status !== "active" ? { s: "active", label: "Reactivate" } : null,
        program.status === "active" ? { s: "completed", label: "Mark complete" } : null,
        program.status !== "archived" ? { s: "archived", label: "Archive" } : null,
      ];

  return (
    <div>
      <Link href="/coach/programs" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Programs
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {program.name}
            <Badge tone={STATUS_TONE[program.status as keyof typeof STATUS_TONE]}>
              {isTemplate && program.status === "active" ? "Published" : program.status}
            </Badge>
          </span>
        }
        description={
          isTemplate ? (
            `Template · ${program.duration_weeks} weeks · ${workouts.length} workouts${coach ? ` · by ${displayName(coach)}` : ""}`
          ) : (
            <>
              For{" "}
              <Link href={`/coach/clients/${program.client_id}`} className="font-medium text-brand hover:underline">
                {displayName(client)}
              </Link>
              {program.start_date ? ` · starts ${longDateLabel(program.start_date)}` : ""}
              {position && program.status === "active" ? ` · week ${position.week} of ${program.duration_weeks}` : ""}
              {` · coach ${coach ? displayName(coach) : "unassigned"}`}
            </>
          )
        }
        actions={
          <>
            {statusButtons.filter(Boolean).map((b) => (
              <ActionForm key={b!.s} action={setProgramStatus.bind(null, program.id, b!.s)}>
                <SubmitButton variant="outline" size="sm">{b!.label}</SubmitButton>
              </ActionForm>
            ))}
            <ActionForm action={duplicateProgram.bind(null, program.id)}>
              <SubmitButton variant="outline" size="sm" pendingLabel="Copying…">
                {isTemplate ? "Duplicate" : "Save as template"}
              </SubmitButton>
            </ActionForm>
            {isTemplate ? (
              <ActionForm action={deleteProgram.bind(null, program.id)}>
                <ConfirmSubmit variant="danger" confirm={`Delete the template “${program.name}”? Client copies are kept.`}>
                  Delete
                </ConfirmSubmit>
              </ActionForm>
            ) : null}
          </>
        }
      />

      {sp.assigned ? (
        <div className="mb-4">
          <Alert tone="green">Program assigned. This is {displayName(client)}&apos;s own copy: edits here only affect them.</Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <details>
            <summary className="cursor-pointer text-base font-semibold tracking-tight">Program details</summary>
            <ActionForm action={updateProgramMeta.bind(null, program.id)} className="mt-4 flex flex-col gap-3">
              <Field label="Name" htmlFor="name">
                <Input id="name" name="name" defaultValue={program.name} required maxLength={120} />
              </Field>
              <Field label="Goal" htmlFor="goal">
                <Input id="goal" name="goal" defaultValue={program.goal ?? ""} maxLength={200} />
              </Field>
              <Field label="Description" htmlFor="description">
                <Textarea id="description" name="description" defaultValue={program.description ?? ""} maxLength={4000} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Length (weeks)" htmlFor="duration_weeks" hint="Shortening removes workouts in the dropped weeks.">
                  <Input id="duration_weeks" name="duration_weeks" type="number" min={1} max={52} defaultValue={program.duration_weeks} required />
                </Field>
                {!isTemplate ? (
                  <Field label="Start date" htmlFor="start_date">
                    <Input id="start_date" name="start_date" type="date" defaultValue={program.start_date ?? ""} />
                  </Field>
                ) : null}
              </div>
              <div>
                <SubmitButton size="sm">Save details</SubmitButton>
              </div>
            </ActionForm>
            {staff.length > 1 || !coach ? (
              <ActionForm action={setProgramCoach.bind(null, program.id)} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <Field
                  label={isTemplate ? "Author" : "Responsible coach"}
                  htmlFor="coach_id"
                  hint={isTemplate ? undefined : "Gets this client's workout logs and program feedback."}
                  className="min-w-48 flex-1"
                >
                  <Select id="coach_id" name="coach_id" defaultValue={coach?.user_id ?? profile.id}>
                    {staff.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {displayName(m)}
                        {m.user_id === profile.id ? " (you)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton size="sm" variant="outline">Save coach</SubmitButton>
              </ActionForm>
            ) : null}
          </details>
        </Card>

        {isTemplate ? (
          <Card>
            <CardTitle>Assign to a client</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">The client gets their own copy you can tailor without touching this template.</p>
            {roster.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">No active clients yet.</p>
            ) : (
              <ActionForm action={assignProgram.bind(null, program.id)} className="mt-3 flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client" htmlFor="assign_client">
                    <Select id="assign_client" name="client_id" required defaultValue="">
                      <option value="" disabled>Choose a client</option>
                      {roster.map((c) => (
                        <option key={c.client_id} value={c.client_id}>{displayName(c.client)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Start date" htmlFor="assign_start">
                    <Input id="assign_start" name="start_date" type="date" required defaultValue={today} />
                  </Field>
                </div>
                <Checkbox name="archive_others" defaultChecked label="Mark the client's current active program complete" />
                <div>
                  <SubmitButton size="sm" pendingLabel="Assigning…">Assign program</SubmitButton>
                </div>
              </ActionForm>
            )}
          </Card>
        ) : (
          <Card>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Adherence</CardTitle>
              {overall != null ? <span className="text-2xl font-bold tracking-tight">{overall}%</span> : null}
            </div>
            <p className="mb-3 text-xs text-zinc-500">Prescribed workouts completed, by week.</p>
            <AdherenceBars weeks={weeks} currentWeek={currentWeek} />
            {flags.length ? (
              <div className="mt-3">
                <FlagBadges flags={flags} />
              </div>
            ) : null}
          </Card>
        )}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Builder</h2>
      <ProgramBuilder
        key={`${program.duration_weeks}-${program.start_date}`}
        programId={program.id}
        durationWeeks={program.duration_weeks}
        startDate={program.start_date}
        initialWorkouts={workouts}
        library={library ?? []}
      />

      {!isTemplate ? (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="logs-h" id="logs">
            <h2 id="logs-h" className="mb-3 text-lg font-semibold">Workout logs</h2>
            {logs.length === 0 ? (
              <EmptyState title="No workouts logged yet" description="Logs from this program will show up here with the client's feedback." />
            ) : (
              <div className="flex flex-col gap-2">
                {logs.map((log) => (
                  <WorkoutLogItem key={log.id} log={log} respondAction={respondToWorkoutLog.bind(null, log.id)} />
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="fb-h" id="feedback">
            <h2 id="fb-h" className="mb-3 text-lg font-semibold">Program feedback</h2>
            {feedback.length === 0 ? (
              <EmptyState title="No feedback yet" description="Clients are prompted at the end of each week to tell you how the plan feels." />
            ) : (
              <div className="flex flex-col gap-2">
                {feedback.map((fb) => (
                  <ProgramFeedbackItem key={fb.id} fb={fb} respondAction={respondToProgramFeedback.bind(null, fb.id)} />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
