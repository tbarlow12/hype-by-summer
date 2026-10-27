import Link from "next/link";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { titleCase } from "@/lib/format";
import { EQUIPMENT, EXERCISE_CATEGORIES, MUSCLES } from "@/lib/training/constants";
import { EXERCISE_FIELDS } from "@/lib/training/server";

export const metadata = { title: "Exercise library" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || "";

export default async function ExercisesPage({ searchParams }: PageProps<"/coach/exercises">) {
  const profile = await requireTrainer();
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const category = one(sp.category);
  const muscle = one(sp.muscle);
  const equipment = one(sp.equipment);
  const source = one(sp.source) || "all";

  const supabase = await createClient();
  let query = supabase.from("exercises").select(EXERCISE_FIELDS).order("name").limit(300);
  if (q) query = query.ilike("name", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if ((EXERCISE_CATEGORIES as readonly string[]).includes(category)) query = query.eq("category", category);
  if (muscle) query = query.contains("primary_muscles", [muscle]);
  if (equipment) query = query.contains("equipment", [equipment]);
  if (source === "mine") query = query.eq("trainer_id", profile.id);
  else if (source === "global") query = query.is("trainer_id", null);
  else query = query.or(`trainer_id.is.null,trainer_id.eq.${profile.id}`);
  const { data: exercises } = await query;
  const filtered = !!(q || category || muscle || equipment || source !== "all");

  return (
    <div>
      <PageHeader
        title="Exercise library"
        description="The shared library plus your own exercises. Duplicate any global exercise to add your own cues and demo video."
        actions={<LinkButton href="/coach/exercises/new">New exercise</LinkButton>}
      />

      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search exercises</label>
        <Input id="q" name="q" type="search" placeholder="Search exercises…" defaultValue={q} />
        <label className="sr-only" htmlFor="category">Category</label>
        <Select id="category" name="category" defaultValue={category}>
          <option value="">All categories</option>
          {EXERCISE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{titleCase(c)}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="muscle">Muscle</label>
        <Select id="muscle" name="muscle" defaultValue={muscle}>
          <option value="">All muscles</option>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>{titleCase(m)}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="equipment">Equipment</label>
        <Select id="equipment" name="equipment" defaultValue={equipment}>
          <option value="">Any equipment</option>
          {EQUIPMENT.map((m) => (
            <option key={m} value={m}>{titleCase(m)}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="source">Source</label>
        <Select id="source" name="source" defaultValue={source}>
          <option value="all">All exercises</option>
          <option value="mine">My exercises</option>
          <option value="global">Global library</option>
        </Select>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("secondary")}>Filter</button>
          {filtered ? (
            <Link href="/coach/exercises" className={buttonClass("ghost")}>Clear</Link>
          ) : null}
        </div>
      </form>

      {!exercises?.length ? (
        <EmptyState
          title={filtered ? "No exercises match" : "No exercises yet"}
          description={filtered ? "Try a different search or clear the filters." : "Create your first exercise to start building programs."}
          action={<LinkButton href="/coach/exercises/new" size="sm">New exercise</LinkButton>}
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-zinc-500">{exercises.length} exercise{exercises.length === 1 ? "" : "s"}</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {exercises.map((ex) => (
              <li key={ex.id}>
                <Link href={`/coach/exercises/${ex.id}`} className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-brand">
                  <Card className="h-full transition-colors hover:border-brand/50">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{ex.name}</p>
                      <div className="flex shrink-0 gap-1">
                        {ex.demo_video_url ? <Badge tone="blue">Video</Badge> : null}
                        {ex.trainer_id ? <Badge tone="brand">Mine</Badge> : null}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {[ex.category && titleCase(ex.category), ex.is_unilateral && "Unilateral"].filter(Boolean).join(" · ") || "Uncategorized"}
                    </p>
                    {ex.primary_muscles.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ex.primary_muscles.slice(0, 4).map((m) => (
                          <Badge key={m}>{titleCase(m)}</Badge>
                        ))}
                      </div>
                    ) : null}
                    {ex.equipment.length ? (
                      <p className="mt-2 text-xs text-zinc-500">{ex.equipment.map(titleCase).join(", ")}</p>
                    ) : null}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
