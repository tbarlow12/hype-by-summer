import Link from "next/link";
import { BRAND_NAME } from "@/lib/env";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <Link href="/" className="mb-8 text-xl font-extrabold tracking-tight text-brand">
        {BRAND_NAME}
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
