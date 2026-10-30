import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Card, CardTitle, Checkbox, LinkButton, PageHeader, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { businessUrl } from "@/lib/tenant";
import { deleteMagnet, saveMagnet } from "../actions";
import { MagnetForm } from "../magnet-form";
import { magnetStats, pct, statsFor } from "../stats";
import { CopyButton, UtmBuilder } from "../utm-builder";

export const metadata: Metadata = { title: "Edit lead magnet" };

export default async function EditLeadMagnetPage({ params, searchParams }: PageProps<"/coach/lead-magnets/[id]">) {
  const { id } = await params;
  const { created } = await searchParams;
  const { business } = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: magnet }, stats] = await Promise.all([
    supabase.from("lead_magnets").select("*").eq("id", id).eq("business_id", business.id).maybeSingle(),
    magnetStats(business.id),
  ]);
  if (!magnet) notFound();
  const s = statsFor(stats, magnet.id);
  const url = businessUrl(business, `/free/${magnet.slug}`);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/coach/lead-magnets" className="text-sm text-zinc-500 hover:text-brand">
          ← Lead magnets
        </Link>
        <div className="mt-2">
          <PageHeader
            title={magnet.title}
            description={url}
            actions={
              <>
                <CopyButton text={url} />
                <LinkButton href={`/free/${magnet.slug}`} variant="outline" size="sm" target="_blank">
                  Preview
                </LinkButton>
                <LinkButton href={`/coach/leads?magnet=${magnet.id}`} variant="ghost" size="sm">
                  View leads
                </LinkButton>
              </>
            }
          />
        </div>
      </div>

      {created ? <Alert tone="green">Lead magnet created. Share the link below to start collecting leads.</Alert> : null}
      {!magnet.file_path ? <Alert tone="amber">Upload the PDF so new leads can download it.</Alert> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Leads" value={s.leads} />
        <Stat label="Downloads" value={s.downloads} hint={`${s.unique_downloads} unique`} />
        <Stat label="Download rate" value={pct(s.unique_downloads, s.leads)} />
        <Stat label="Consults" value={s.consults} hint={pct(s.consults, s.leads)} />
        <Stat label="Clients" value={s.converted} hint={pct(s.converted, s.leads)} />
      </div>

      <Card>
        <CardTitle>Tracking link builder</CardTitle>
        <p className="mt-1 text-sm text-zinc-500">
          Add UTM tags so you can see which posts, ads and emails bring in leads. Filter by campaign in Leads.
        </p>
        <div className="mt-4">
          <UtmBuilder baseUrl={url} defaultCampaign={magnet.slug} />
        </div>
      </Card>

      <Card className="p-6">
        <MagnetForm action={saveMagnet.bind(null, magnet.id)} magnet={magnet} />
      </Card>

      <details className="rounded-2xl border border-red-200 p-4 dark:border-red-900">
        <summary className="cursor-pointer text-sm font-semibold text-red-700 dark:text-red-400">Delete lead magnet</summary>
        <ActionForm action={deleteMagnet.bind(null, magnet.id)} className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-zinc-500">The landing page and PDF are removed. Leads it captured are kept.</p>
          <Checkbox name="confirm" required label="Yes, delete this lead magnet and its PDF." />
          <div>
            <SubmitButton variant="danger" size="sm" pendingLabel="Deleting…">
              Delete
            </SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}
