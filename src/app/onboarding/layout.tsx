import Link from "next/link";
import { BRAND_NAME } from "@/lib/env";

export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-12">
      <Link href="/" className="mb-8 text-xl font-extrabold tracking-tight text-brand">
        {BRAND_NAME}
      </Link>
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}
