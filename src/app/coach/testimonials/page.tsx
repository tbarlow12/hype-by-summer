import type { Metadata } from "next";
import { Badge, Card, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { Stars } from "@/components/marketing/sections";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { Tables } from "@/lib/supabase/database.types";
import { deleteTestimonial, setTestimonialApproved } from "./actions";
import { AddTestimonialForm } from "./add-form";

export const metadata: Metadata = { title: "Testimonials" };

function TestimonialCard({ t, timeZone }: { t: Tables<"testimonials">; timeZone: string }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{t.author_name}</p>
          <p className="text-xs text-zinc-500">
            {formatDate(t.created_at, timeZone)} · {t.client_id ? "Submitted by client" : "Added by you"}
          </p>
        </div>
        {t.approved ? <Badge tone="green">On website</Badge> : <Badge tone="amber">Pending</Badge>}
      </div>
      {t.rating ? <Stars rating={t.rating} /> : null}
      <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{t.body}</p>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <form action={setTestimonialApproved}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="approved" value={t.approved ? "false" : "true"} />
          <button className={t.approved ? "h-8 rounded-full px-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800" : "h-8 rounded-full bg-brand px-3 text-sm font-semibold text-on-brand hover:bg-brand-dark"}>
            {t.approved ? "Hide" : "Approve"}
          </button>
        </form>
        <form action={deleteTestimonial}>
          <input type="hidden" name="id" value={t.id} />
          <button className="h-8 rounded-full px-3 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Delete</button>
        </form>
      </div>
    </Card>
  );
}

export default async function TestimonialsPage() {
  const trainer = await requireTrainer();
  const supabase = await createClient();
  const { data } = await supabase.from("testimonials").select("*").eq("trainer_id", trainer.id).order("created_at", { ascending: false });
  const all = data ?? [];
  const pending = all.filter((t) => !t.approved);
  const approved = all.filter((t) => t.approved);

  return (
    <div className="space-y-8">
      <PageHeader title="Testimonials" description="Approved reviews appear on your homepage and free-guide pages." />

      <section aria-labelledby="pending-h">
        <h2 id="pending-h" className="mb-3 text-lg font-semibold">
          Waiting for approval {pending.length ? <Badge tone="amber">{pending.length}</Badge> : null}
        </h2>
        {pending.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((t) => (
              <TestimonialCard key={t.id} t={t} timeZone={trainer.timezone} />
            ))}
          </div>
        ) : (
          <EmptyState title="Nothing to review" description="When clients leave a review from their portal it shows up here for you to approve." />
        )}
      </section>

      <section aria-labelledby="live-h">
        <h2 id="live-h" className="mb-3 text-lg font-semibold">On the website</h2>
        {approved.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {approved.map((t) => (
              <TestimonialCard key={t.id} t={t} timeZone={trainer.timezone} />
            ))}
          </div>
        ) : (
          <EmptyState title="No approved testimonials yet" description="Approve a client review or add one below. Social proof makes a big difference on your homepage." />
        )}
      </section>

      <Card>
        <CardTitle>Add a testimonial</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">For reviews you received elsewhere. Only add reviews you have permission to share.</p>
        <div className="mt-4">
          <AddTestimonialForm />
        </div>
      </Card>
    </div>
  );
}
