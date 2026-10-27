import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { OfferingForm } from "@/components/payments/offering-form";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveOffering } from "../actions";

export const metadata = { title: "New offering" };

export default async function NewOfferingPage() {
  const trainer = await requireTrainer();
  const supabase = await createClient();
  const { data: sessionTypes } = await supabase
    .from("session_types")
    .select("id, name")
    .eq("trainer_id", trainer.id)
    .eq("active", true)
    .order("sort_order");

  return (
    <div className="max-w-2xl">
      <p className="mb-2 text-sm">
        <Link href="/coach/offerings" className="text-zinc-500 hover:text-brand">
          ← Packages & plans
        </Link>
      </p>
      <PageHeader title="New offering" description="It's created in Stripe as a product with a price when you save." />
      <Card>
        <OfferingForm action={saveOffering} sessionTypes={sessionTypes ?? []} trainerId={trainer.id} />
      </Card>
    </div>
  );
}
