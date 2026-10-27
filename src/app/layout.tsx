import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { Suspense } from "react";
import { AttributionTracker } from "@/components/attribution-tracker";
import { BRAND_NAME, SITE_URL } from "@/lib/env";
import "./globals.css";

// Squared, athletic letterforms: Barlow for text, Barlow Condensed for display.
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  style: ["normal", "italic"],
});

// Every page reads live data (availability, prices, the signed-in user), so
// render per request rather than prerendering at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description: "Personal training, coaching programs and online sessions.",
  openGraph: { siteName: BRAND_NAME, type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#e11d48",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Suspense fallback={null}>
          <AttributionTracker />
        </Suspense>
      </body>
    </html>
  );
}
