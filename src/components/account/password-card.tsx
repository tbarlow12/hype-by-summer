import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CardTitle, Field, Input } from "@/components/ui";
import { setPassword } from "./password-actions";

export function PasswordCard() {
  return (
    <Card>
      <CardTitle>Password</CardTitle>
      <p className="mb-4 mt-1 text-sm text-zinc-500">
        Set a password to sign in without an email link. Forgot it? Use &ldquo;magic link&rdquo; on the sign-in page, then set a new one here.
      </p>
      <ActionForm action={setPassword} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" htmlFor="new-password">
          <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Confirm password" htmlFor="confirm-password">
          <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <div className="sm:col-span-2">
          <SubmitButton>Save password</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
