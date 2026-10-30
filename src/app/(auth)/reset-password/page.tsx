import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ResetPasswordForm } from "./reset-form";

export const metadata = { title: "Choose a new password" };

// Recovery links (lib/auth-emails.ts → /auth/confirm?type=recovery) sign the
// person in and land here.
export default async function ResetPasswordPage() {
  const profile = await requireUser("/reset-password");
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-bold">Choose a new password</h1>
      <p className="mb-6 text-sm text-zinc-500">For {profile.email}.</p>
      <ResetPasswordForm />
    </Card>
  );
}
