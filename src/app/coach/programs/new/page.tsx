import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { todayInTz } from "@/lib/training/dates";
import { createProgram } from "../actions";

export const metadata = { title: "New program" };

export default async function NewProgramPage({ searchParams }: PageProps<"/coach/programs/new">) {
  const profile = await requireTrainer();
  const sp = await searchParams;
  const preselect = typeof sp.client === "string" ? sp.client : "";
  const supabase = await createClient();
  const { data: roster } = await supabase
    .from("trainer_clients")
    .select("client_id, status, client:profiles!trainer_clients_client_id_fkey(full_name, email)")
    .eq("trainer_id", profile.id)
    .in("status", ["active", "invited", "paused"]);
  const clients = (roster ?? []).sort((a, b) => displayName(a.client).localeCompare(displayName(b.client)));

  return (
    <div className="max-w-2xl">
      <Link href="/coach/programs" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Programs
      </Link>
      <PageHeader title="New program" description="Start with the basics. You'll lay out weeks, days and exercises next." />
      <Card>
        <ActionForm action={createProgram} className="flex flex-col gap-4">
          <Field label="Program name" htmlFor="name">
            <Input id="name" name="name" required maxLength={120} placeholder="Summer Strength Block" />
          </Field>
          <Field label="Goal" htmlFor="goal" hint="Shown to the client, e.g. “Build a stronger squat and deadlift”">
            <Input id="goal" name="goal" maxLength={200} />
          </Field>
          <Field label="Description" htmlFor="description">
            <Textarea id="description" name="description" maxLength={4000} />
          </Field>
          <Field label="Length (weeks)" htmlFor="duration_weeks">
            <Input id="duration_weeks" name="duration_weeks" type="number" min={1} max={52} defaultValue={4} required className="w-32" />
          </Field>
          <fieldset className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <legend className="px-1 text-sm font-semibold">Who is it for?</legend>
            <p className="mb-3 text-xs text-zinc-500">Leave the client empty to build a reusable template.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client" htmlFor="client_id">
                <Select id="client_id" name="client_id" defaultValue={preselect}>
                  <option value="">Template (no client)</option>
                  {clients.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {displayName(c.client)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start date" htmlFor="start_date" hint="Required for a client program. Day 1 = this date.">
                <Input id="start_date" name="start_date" type="date" defaultValue={todayInTz(profile.timezone)} />
              </Field>
            </div>
          </fieldset>
          <div>
            <SubmitButton>Create and open builder</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
