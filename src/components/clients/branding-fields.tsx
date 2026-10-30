"use client";

import { useId, useState } from "react";
import { brandPalette, isHexColor } from "@/lib/brand-palette";
import { FONT_PRESETS, brandContrastWarnings, type FontPreset } from "@/lib/clients/branding";
import { Input, cn } from "@/components/ui";
import { ImageUpload } from "./image-upload";

/**
 * Logo, brand color and font fields for Settings → Branding, with a live
 * preview of buttons, brand text and headings in light and dark mode.
 * Submits `logo_url`, `brand_color` and `font_preset`.
 */
export function BrandingFields({
  businessId,
  businessName,
  logoUrl,
  color,
  font,
}: {
  businessId: string;
  businessName: string;
  logoUrl: string | null;
  color: string;
  font: FontPreset;
}) {
  const [hex, setHex] = useState(color);
  const [text, setText] = useState(color);
  const [preset, setPreset] = useState<FontPreset>(font);
  const [logo, setLogo] = useState(logoUrl ?? "");
  const id = useId();
  const palette = brandPalette(hex);
  const warnings = brandContrastWarnings(hex);
  const fontDef = FONT_PRESETS.find((f) => f.value === preset) ?? FONT_PRESETS[0];

  const onText = (v: string) => {
    setText(v);
    const withHash = v.startsWith("#") ? v : `#${v}`;
    if (isHexColor(withHash)) setHex(withHash.toLowerCase());
  };

  return (
    <div className="space-y-6">
      <ImageUpload
        folder={businessId}
        name="logo_url"
        prefix="logo"
        defaultUrl={logoUrl}
        label="Logo"
        shape="square"
        onChange={setLogo}
      />
      <p className="-mt-4 text-xs text-zinc-500">A square PNG with a transparent or white background works best. It also becomes your app icon.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-hex`} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Brand color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick brand color"
                value={hex}
                onChange={(e) => {
                  setHex(e.target.value);
                  setText(e.target.value);
                }}
                className="h-10 w-14 cursor-pointer rounded-lg border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <Input
                id={`${id}-hex`}
                value={text}
                onChange={(e) => onText(e.target.value.trim())}
                maxLength={7}
                spellCheck={false}
                className="w-32 font-mono uppercase"
                aria-describedby={`${id}-warn`}
              />
              <input type="hidden" name="brand_color" value={hex} />
            </div>
          </div>
          <ul id={`${id}-warn`} aria-live="polite" className="space-y-1.5 text-sm">
            {warnings.length ? (
              warnings.map((w) => (
                <li
                  key={w.message}
                  className={cn(
                    "rounded-lg px-3 py-2",
                    w.level === "warn"
                      ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                      : "bg-zinc-50 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400",
                  )}
                >
                  {w.level === "warn" ? "Low contrast: " : ""}
                  {w.message}
                </li>
              ))
            ) : (
              <li className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Great contrast in light and dark mode.
              </li>
            )}
          </ul>

          <fieldset>
            <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Font style</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {FONT_PRESETS.map((f) => (
                <label
                  key={f.value}
                  className={cn(
                    "cursor-pointer rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
                    preset === f.value
                      ? "border-brand bg-brand/5"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50",
                  )}
                >
                  <input
                    type="radio"
                    name="font_preset"
                    value={f.value}
                    checked={preset === f.value}
                    onChange={() => setPreset(f.value)}
                    className="sr-only"
                  />
                  <span
                    className={cn("block text-xl font-bold leading-tight", f.uppercase && "uppercase")}
                    style={{ fontFamily: f.display }}
                  >
                    {f.label}
                  </span>
                  <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400" style={{ fontFamily: f.sans }}>
                    {f.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-3" aria-label="Preview">
          {(["light", "dark"] as const).map((mode) => {
            const dark = mode === "dark";
            const brandText = dark ? palette.textDark : palette.textLight;
            return (
              <div
                key={mode}
                className="rounded-2xl border p-5"
                style={{
                  background: dark ? "#09090b" : "#fafafa",
                  color: dark ? "#f4f4f5" : "#18181b",
                  borderColor: dark ? "#27272a" : "#e4e4e7",
                  fontFamily: fontDef.sans,
                }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: dark ? "#a1a1aa" : "#71717a" }}>
                  {dark ? "Dark mode" : "Light mode"}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" className="size-8 rounded-md bg-white object-contain p-0.5" />
                  ) : null}
                  <span className="font-bold" style={{ color: brandText, fontFamily: fontDef.display }}>
                    {businessName}
                  </span>
                </div>
                <p
                  className={cn("mt-3 text-2xl font-bold leading-tight", fontDef.uppercase && "uppercase")}
                  style={{ fontFamily: fontDef.display }}
                >
                  Train with us
                </p>
                <p className="mt-1 text-sm" style={{ color: dark ? "#a1a1aa" : "#52525b" }}>
                  Book a session and{" "}
                  <span className="font-semibold underline" style={{ color: brandText }}>
                    see the schedule
                  </span>
                  .
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex h-9 items-center rounded-full px-4 text-sm font-bold uppercase tracking-wider"
                    style={{ background: palette.brand, color: palette.onBrand, fontFamily: fontDef.display }}
                  >
                    Book now
                  </span>
                  <span
                    className="inline-flex h-9 items-center rounded-full px-4 text-sm font-bold uppercase tracking-wider"
                    style={{ background: palette.brandDark, color: palette.onBrand, fontFamily: fontDef.display }}
                  >
                    Hover
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ color: brandText, background: `${palette.brand}1a` }}
                  >
                    New
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
