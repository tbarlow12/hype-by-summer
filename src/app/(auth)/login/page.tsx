import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { getBusiness } from "@/lib/tenant";
import { safeNext } from "@/lib/auth-emails";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" ? safeNext(next) : undefined;
  const business = await getBusiness();
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {business ? "Sign in to your training portal." : "Sign in to manage your business."}
      </p>
      {error ? (
        <div className="mb-4">
          <Alert tone="red">That link is invalid or has expired. Sign in below or ask for a new link.</Alert>
        </div>
      ) : null}
      <LoginForm next={nextPath} />
      <p className="mt-6 text-center text-sm text-zinc-500">
        New here?{" "}
        <Link href={`/signup${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`} className="font-semibold text-brand">
          Create an account
        </Link>
      </p>
    </Card>
  );
}
