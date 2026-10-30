import { Bricolage_Grotesque, Geist } from "next/font/google";

// The platform's own type (distinct from the trainer-site presets).
export const platformDisplay = Bricolage_Grotesque({
  variable: "--font-p-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});
export const platformSans = Geist({ variable: "--font-p-sans", subsets: ["latin"] });

export const platformFontClass = `${platformDisplay.variable} ${platformSans.variable}`;
