import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { saveMagnet } from "../actions";
import { MagnetForm } from "../magnet-form";

export const metadata: Metadata = { title: "New lead magnet" };

export default async function NewLeadMagnetPage() {
  await requireTrainer();
  return (
    <div>
      <Link href="/coach/lead-magnets" className="text-sm text-zinc-500 hover:text-brand">
        ← Lead magnets
      </Link>
      <div className="mt-2">
        <PageHeader title="New lead magnet" description="A free PDF plus a landing page at /free/your-link." />
      </div>
      <Card className="p-6">
        <MagnetForm action={saveMagnet.bind(null, null)} />
      </Card>
    </div>
  );
}
