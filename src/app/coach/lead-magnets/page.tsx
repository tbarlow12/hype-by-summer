import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { GuideCover } from "@/components/marketing/sections";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { businessUrl } from "@/lib/tenant";
import { toggleMagnetActive } from "./actions";
import { magnetStats, pct, statsFor } from "./stats";
import { CopyButton } from "./utm-builder";

export const metadata: Metadata = { title: "Lead magnets" };

export default async function LeadMagnetsPage() {
  const { business } = await requireStaff();
  const supabase = await createClient();
  const [{ data: magnets }, stats] = await Promise.all([
    supabase.from("lead_magnets").select("*").eq("business_id", business.id).order("created_at", { ascending: false }),
    magnetStats(business.id),
  ]);
  const list = magnets ?? [];
  const totals = list.reduce(
    (acc, m) => {
      const s = statsFor(stats, m.id);
      return { leads: acc.leads + s.leads, unique: acc.unique + s.unique_downloads, converted: acc.converted + s.converted, consults: acc.consults + s.consults };
    },
    { leads: 0, unique: 0, converted: 0, consults: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead magnets"
        description="Free guides that turn visitors into leads. Share the link anywhere; sign-ups land in Leads."
        actions={
          <>
            <LinkButton href="/coach/testimonials" variant="outline" size="sm">
              Testimonials
            </LinkButton>
            <LinkButton href="/coach/lead-magnets/new" size="sm">
              New lead magnet
            </LinkButton>
          </>
        }
      />

      {list.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Leads captured</p>
              <p className="mt-1 text-2xl font-bold">{totals.leads}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Download rate</p>
              <p className="mt-1 text-2xl font-bold">{pct(totals.unique, totals.leads)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Consults booked</p>
              <p className="mt-1 text-2xl font-bold">{totals.consults}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Became clients</p>
              <p className="mt-1 text-2xl font-bold">
                {totals.converted} <span className="text-sm font-medium text-zinc-500">({pct(totals.converted, totals.leads)})</span>
              </p>
            </Card>
          </div>

          <ul className="space-y-4">
            {list.map((m) => {
              const s = statsFor(stats, m.id);
              const url = businessUrl(business, `/free/${m.slug}`);
              return (
                <li key={m.id}>
                  <Card className="flex flex-col gap-5 sm:flex-row">
                    <Link href={`/coach/lead-magnets/${m.id}`} className="w-24 shrink-0 self-start">
                      <GuideCover title={m.title} src={m.cover_image_url} small className="rounded-xl shadow-md" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/coach/lead-magnets/${m.id}`} className="text-lg font-semibold hover:text-brand">
                          {m.title}
                        </Link>
                        {m.active ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>}
                        {!m.file_path ? <Badge tone="amber">No PDF</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-zinc-500">{url}</p>
                      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                        {[
                          ["Leads", s.leads],
                          ["Downloads", s.downloads],
                          ["Download rate", pct(s.unique_downloads, s.leads)],
                          ["Consults", s.consults],
                          ["Clients", s.converted],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs text-zinc-500">{label}</dt>
                            <dd className="font-bold tabular-nums">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <CopyButton text={url} />
                        <LinkButton href={`/coach/lead-magnets/${m.id}`} variant="outline" size="sm">
                          Edit & tracking links
                        </LinkButton>
                        <LinkButton href={`/coach/leads?magnet=${m.id}`} variant="ghost" size="sm">
                          View leads
                        </LinkButton>
                        <a href={`/free/${m.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center px-3 text-sm font-semibold text-zinc-600 hover:text-brand dark:text-zinc-300">
                          Preview ↗
                        </a>
                        <form action={toggleMagnetActive} className="ml-auto">
                          <input type="hidden" name="id" value={m.id} />
                          <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                          <button className="h-8 rounded-full px-3 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                            {m.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          title="No lead magnets yet"
          description="Upload a free PDF (a starter plan, recipe pack or habit tracker) and get a landing page that captures leads and emails the guide automatically."
          action={<LinkButton href="/coach/lead-magnets/new">Create your first lead magnet</LinkButton>}
        />
      )}
    </div>
  );
}
