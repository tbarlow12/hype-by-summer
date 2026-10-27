import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { signup } from "../actions";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next, email } = await searchParams;
  const nextPath = typeof next === "string" ? next : "";
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-bold">Create your account</h1>
      <p className="mb-6 text-sm text-zinc-500">Book sessions, follow your plan and message your coach.</p>
      <ActionForm action={signup} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <Field label="Full name" htmlFor="full_name">
          <Input id="full_name" name="full_name" autoComplete="name" required />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" defaultValue={typeof email === "string" ? email : ""} required />
        </Field>
        <Field label="Phone (optional)" htmlFor="phone" hint="For session reminders by text.">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`} className="font-semibold text-brand">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
