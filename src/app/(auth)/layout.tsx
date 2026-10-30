import Link from "next/link";
import { brandOf, getBusiness } from "@/lib/tenant";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // Branded per business; on the platform's own site this shows the platform name.
  const brand = brandOf(await getBusiness());
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
