import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { forgotPassword } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-bold">Forgot your password?</h1>
      <p className="mb-6 text-sm text-zinc-500">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <ActionForm action={forgotPassword} className="flex flex-col gap-4" resetOnSuccess>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-zinc-500">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-brand">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
