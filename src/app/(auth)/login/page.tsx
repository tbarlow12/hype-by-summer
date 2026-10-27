import Link from "next/link";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-6 text-sm text-zinc-500">Sign in to your training portal.</p>
      {error ? <p className="mb-4 text-sm text-red-600">That link is invalid or expired. Try again.</p> : null}
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
