import Link from "next/link";
import { Avatar, Badge, Card, cn, EmptyState } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { coachesForType, listBookableSessionTypes } from "@/lib/scheduling/availability";
import { locationSummary, priceLabel } from "@/lib/scheduling/labels";
import { publicBookingContext } from "@/lib/scheduling/public";

/** The business's booking page: its session types, plus its coaches when there are several. */
export async function Storefront({ coach: coachParam }: { coach?: string }) {
  const { business, isClient, coaches } = await publicBookingContext();
  const types = await listBookableSessionTypes(business.id, { includeClientsOnly: isClient, coaches });
  // Only coaches who run at least one listed session appear.
  const team = coaches.filter((c) => types.some((t) => t.coach_ids.includes(c.id)));
  const coach = coachParam ? team.find((c) => c.id === coachParam || c.slug === coachParam.toLowerCase()) : undefined;
  const shown = coach ? types.filter((t) => t.coach_ids.includes(coach.id)) : types;
  const href = (slug: string) => `/book/${slug}${coach ? `?coach=${coach.id}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {business.logo_url ? <Avatar name={business.name} src={business.logo_url} size={64} /> : null}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{business.name}</h1>
          {business.headline ? <p className="text-sm text-zinc-500">{business.headline}</p> : null}
        </div>
      </div>
      {business.bio ? <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{business.bio}</p> : null}

      {team.length > 1 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Our coaches</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((c) => {
              const active = coach?.id === c.id;
              return (
                <li key={c.id}>
                  <Link
                    href={active ? "/book" : `/book?coach=${c.id}`}
                    aria-current={active ? "true" : undefined}
                    className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <Card className={cn("flex h-full gap-3 transition-colors hover:border-brand/50", active && "border-brand")}>
                      <Avatar name={c.name} src={c.avatarUrl} size={48} />
                      <div className="min-w-0">
                        <p className="font-semibold">{c.name}</p>
                        {c.title ? <p className="text-xs text-zinc-500">{c.title}</p> : null}
                        {c.bio ? <p className="mt-1 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{c.bio}</p> : null}
                        <p className="mt-2 text-xs font-semibold text-brand">{active ? "Showing their sessions · show all" : "See their sessions"}</p>
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <h2 className="text-lg font-semibold">{coach ? `Sessions with ${coach.name}` : "Choose a session"}</h2>
      {shown.length === 0 ? (
        <EmptyState title="No sessions available right now" description="New times are added regularly. Please check back soon." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shown.map((st) => {
            const stCoaches = coachesForType(st, coaches);
            return (
              <li key={st.id}>
                <Link href={href(st.slug)} className="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-brand">
                  <Card className="flex h-full flex-col gap-2 transition-colors hover:border-brand/50">
                    <div className="flex items-start justify-between gap-3">
                      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.color }} aria-hidden />
                      <h3 className="flex-1 font-semibold">{st.name}</h3>
                      <span className="font-semibold">{priceLabel(st)}</span>
                    </div>
                    {st.description ? <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{st.description}</p> : null}
                    {team.length > 1 && !coach ? (
                      <p className="text-xs text-zinc-500">
                        With {stCoaches.length === 1 ? stCoaches[0]!.name : `${stCoaches.length} coaches`}
                      </p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      <Badge>{formatDuration(st.duration_minutes)}</Badge>
                      <Badge>{locationSummary(st, business.default_location)}</Badge>
                      {st.capacity > 1 ? <Badge tone="purple">Group · up to {st.capacity}</Badge> : null}
                      {st.is_consultation ? <Badge tone="green">Free intro</Badge> : null}
                      {st.clients_only ? <Badge tone="brand">Clients only</Badge> : null}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
