import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PRIMARY_TRAINER_SLUG, BRAND_NAME } from "@/lib/env";
import { setupStorefront } from "./actions";

export const metadata = { title: "Set up your business" };

export default async function SetupPage() {
  const profile = await requireTrainer();
  const supabase = await createClient();
  const { data } = await supabase.from("trainer_profiles").select("slug").eq("trainer_id", profile.id).maybeSingle();
  if (data) redirect("/coach");

  return (
    <div>
      <PageHeader title="Welcome! Let's set up your business" description="You can change all of this later in Settings." />
      <Card>
        <ActionForm action={setupStorefront} className="flex flex-col gap-4">
          <Field label="Business name" htmlFor="business_name">
            <Input id="business_name" name="business_name" defaultValue={BRAND_NAME} required />
          </Field>
          <Field label="Booking link" htmlFor="slug" hint="Your public booking page: /book/<this>">
            <Input id="slug" name="slug" defaultValue={PRIMARY_TRAINER_SLUG} pattern="[a-z0-9][a-z0-9-]{1,40}" required />
          </Field>
          <Field label="Your timezone" htmlFor="timezone">
            <Input id="timezone" name="timezone" defaultValue={profile.timezone} required />
          </Field>
          <Field label="Headline" htmlFor="headline">
            <Input id="headline" name="headline" placeholder="Strength coaching that fits your life" />
          </Field>
          <Field label="Short bio" htmlFor="bio">
            <Textarea id="bio" name="bio" />
          </Field>
          <SubmitButton>Create my storefront</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
