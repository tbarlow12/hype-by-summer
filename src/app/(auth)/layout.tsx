import Link from "next/link";
import { brandOf, getBusiness } from "@/lib/tenant";
import { platformFontClass } from "@/app/platform/fonts";
import { PlatformLogo } from "@/app/platform/_components/logo";
import "@/app/platform/platform.css";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const business = await getBusiness();
  // On the platform's own site these pages wear the platform's brand.
  if (!business) {
    return (
      <div className={`platform-site ${platformFontClass} flex flex-1 flex-col`}>
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
          <Link href="/" className="mb-8">
            <PlatformLogo />
          </Link>
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    );
  }
  // A business's site: its name/logo only.
  const brand = brandOf(business);
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <Link href="/" className="mb-8 text-xl font-extrabold tracking-tight text-brand">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto" />
        ) : (
          brand.name
        )}
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
