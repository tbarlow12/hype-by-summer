import Link from "next/link";
import { Card } from "@/components/ui";
import { getBusiness } from "@/lib/tenant";
import { safeNext } from "@/lib/auth-emails";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next, email } = await searchParams;
  const business = await getBusiness();
  // On the platform's own site, accounts are for trainers starting a business.
  const nextPath = typeof next === "string" ? safeNext(next) : business ? "" : "/start";
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-bold">Create your account</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {business
          ? "Book sessions, follow your plan and message your coach."
          : "Start your business: your own site, booking, payments and client app."}
      </p>
      <SignupForm next={nextPath} email={typeof email === "string" ? email : undefined} askPhone={Boolean(business)} />
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`} className="font-semibold text-brand">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
