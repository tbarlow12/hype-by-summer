import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui";
import { getTrainerBySlug } from "@/lib/trainer";
import { getProfile } from "@/lib/auth";
import { formatDuration } from "@/lib/format";
import { isClientOfTrainer, listBookableSessionTypes } from "@/lib/scheduling/availability";
import { locationSummary, priceLabel } from "@/lib/scheduling/labels";

export async function generateMetadata({ params }: PageProps<"/book/[trainer]">): Promise<Metadata> {
  const trainer = await getTrainerBySlug((await params).trainer);
  return { title: trainer ? `Book with ${trainer.business_name}` : "Book a session" };
}

export default async function TrainerStorefrontPage({ params }: PageProps<"/book/[trainer]">) {
  const { trainer: slug } = await params;
  const trainer = await getTrainerBySlug(slug);
  if (!trainer) notFound();
  const profile = await getProfile();
  const isClient = Boolean(profile && profile.role === "client" && (await isClientOfTrainer(profile.id, trainer.trainer_id)));
  const types = await listBookableSessionTypes(trainer.trainer_id, { includeClientsOnly: isClient });
  const name = trainer.profiles?.full_name ?? trainer.business_name;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar name={name} src={trainer.profiles?.avatar_url} size={64} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{trainer.business_name}</h1>
          {trainer.headline ? <p className="text-sm text-zinc-500">{trainer.headline}</p> : null}
        </div>
      </div>
      {trainer.bio ? <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{trainer.bio}</p> : null}

      <h2 className="text-lg font-semibold">Choose a session</h2>
      {types.length === 0 ? (
        <EmptyState title="No sessions available right now" description="New times are added regularly. Please check back soon." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {types.map((st) => (
            <li key={st.id}>
              <Link href={`/book/${trainer.slug}/${st.slug}`} className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-brand">
                <Card className="flex h-full flex-col gap-2 transition-colors hover:border-brand/50">
                  <div className="flex items-start justify-between gap-3">
                    <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.color }} aria-hidden />
                    <h3 className="flex-1 font-semibold">{st.name}</h3>
                    <span className="font-semibold">{priceLabel(st)}</span>
                  </div>
                  {st.description ? <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{st.description}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    <Badge>{formatDuration(st.duration_minutes)}</Badge>
                    <Badge>{locationSummary(st, trainer.default_location)}</Badge>
                    {st.capacity > 1 ? <Badge tone="purple">Group · up to {st.capacity}</Badge> : null}
                    {st.is_consultation ? <Badge tone="green">Free intro</Badge> : null}
                    {st.clients_only ? <Badge tone="brand">Clients only</Badge> : null}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
