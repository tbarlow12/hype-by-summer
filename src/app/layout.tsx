import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Fraunces, Manrope, Nunito, Sora, Source_Sans_3 } from "next/font/google";
import type { CSSProperties } from "react";
import { Suspense } from "react";
import { AttributionTracker } from "@/components/attribution-tracker";
import { brandOf, getBusiness, siteUrl } from "@/lib/tenant";
import "./globals.css";

// Squared, athletic letterforms: Barlow for text, Barlow Condensed for display.
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  style: ["normal", "italic"],
});
// Other font presets a business can pick (Settings → Branding).
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600", "700", "800"] });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["600", "700", "800", "900"] });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "600", "700", "800", "900"] });
const FONT_VARS = [barlow, barlowCondensed, manrope, sora, sourceSans, fraunces, nunito].map((f) => f.variable).join(" ");

// Every page reads live data (availability, prices, the signed-in user), so
// render per request rather than prerendering at build time.
export const dynamic = "force-dynamic";

// White-label: names, colors and fonts come from the business this host serves.
export async function generateMetadata(): Promise<Metadata> {
  const brand = brandOf(await getBusiness());
  return {
    metadataBase: new URL(await siteUrl("/")),
    title: { default: brand.name, template: `%s · ${brand.name}` },
    description: "Personal training, coaching programs and online sessions.",
    openGraph: { siteName: brand.name, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: brandOf(await getBusiness()).palette.brand };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const business = await getBusiness();
  const { palette } = brandOf(business);
  const theme = {
    "--brand": palette.brand,
    "--brand-dark": palette.brandDark,
    "--on-brand": palette.onBrand,
    "--brand-text-light": palette.textLight,
    "--brand-text-dark": palette.textDark,
  } as CSSProperties;
  const preset = business?.font_preset ?? "athletic";
  return (
    <html lang="en" style={theme} className={`${FONT_VARS} font-preset-${preset} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Suspense fallback={null}>
          <AttributionTracker />
        </Suspense>
      </body>
    </html>
  );
}
