"use client";

import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import { checkSlug, createBusiness, type SlugCheck } from "./actions";
import { slugify, slugProblem } from "./slug";
import { pButton } from "../_components/ui";

const SWATCHES = ["#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0f766e", "#0284c7", "#4f46e5", "#9333ea", "#18181b"];

const input =
  "h-11 w-full rounded-xl border p-line p-surface px-3 text-[15px] outline-none transition focus:border-brand focus:ring-4 focus:ring-[color-mix(in_oklab,var(--brand)_18%,transparent)]";

function zones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Australia/Sydney"];
  }
}

export function BusinessForm({ domain }: { domain: string }) {
  const [state, action, pending] = useActionState(createBusiness, { ok: false } as ActionState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [checking, startCheck] = useTransition();
  const [timezone, setTimezone] = useState("America/Denver");
  const [color, setColor] = useState("#4f46e5");
  const allZones = useMemo(zones, []);
  const ids = { name: useId(), slug: useId(), tz: useId(), color: useId(), slugHelp: useId() };
  const latest = useRef("");

  // Default timezone from the browser.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser-only value
    if (tz) setTimezone(tz);
  }, []);

  // Live availability, debounced.
  const localProblem = slug ? slugProblem(slug) : null;
  useEffect(() => {
    if (!slug || localProblem) return;
    latest.current = slug;
    const t = setTimeout(() => {
      startCheck(async () => {
        const result = await checkSlug(slug);
        if (latest.current === result.slug) setCheck(result);
      });
    }, 350);
    return () => clearTimeout(t);
  }, [slug, localProblem]);

  const current = check?.slug === slug ? check : null;
  const status: { tone: "ok" | "bad" | "muted"; text: string } = !slug
    ? { tone: "muted", text: "Letters, numbers and dashes." }
    : localProblem
      ? { tone: "bad", text: localProblem }
      : checking || !current
        ? { tone: "muted", text: "Checking…" }
        : current.available
          ? { tone: "ok", text: "Available" }
          : { tone: "bad", text: current.problem ?? "Not available" };
  const suggestions = current && !current.available ? current.suggestions : [];
  const canSubmit = Boolean(name.trim().length >= 2 && slug && !localProblem && current?.available);

  return (
    <form
      className="grid gap-6"
      // Submit without React's automatic form reset so the controlled fields keep their values on error.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      {state.error ? <Alert tone="red">{state.error}</Alert> : null}

      <div className="grid gap-1.5">
        <label htmlFor={ids.name} className="text-sm font-semibold">
          Business name
        </label>
        <input
          id={ids.name}
          name="name"
          required
          minLength={2}
          maxLength={80}
          autoComplete="organization"
          placeholder="e.g. Peak Performance Training"
          className={input}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={ids.slug} className="text-sm font-semibold">
          Web address
        </label>
        <div className="flex items-stretch overflow-hidden rounded-xl border p-line p-surface focus-within:border-brand focus-within:ring-4 focus-within:ring-[color-mix(in_oklab,var(--brand)_18%,transparent)]">
          <input
            id={ids.slug}
            name="slug"
            required
            aria-describedby={ids.slugHelp}
            aria-invalid={status.tone === "bad"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 41));
            }}
          />
          <span className="p-surface-2 flex items-center border-l p-line px-3 text-sm p-muted">.{domain}</span>
        </div>
        <p
          id={ids.slugHelp}
          aria-live="polite"
          className={`text-sm ${status.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : status.tone === "bad" ? "text-red-600 dark:text-red-400" : "p-muted"}`}
        >
          {status.tone === "ok" ? "✓ " : ""}
          {status.text}
          {status.tone !== "bad" ? <span className="p-muted"> You can connect your own domain later.</span> : null}
        </p>
        {suggestions.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="p-muted">Try:</span>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSlugEdited(true);
                  setSlug(s);
                }}
                className="rounded-full border p-line px-3 py-1 font-medium hover:border-brand"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={ids.tz} className="text-sm font-semibold">
            Timezone
          </label>
          <select id={ids.tz} name="timezone" className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {(allZones.includes(timezone) ? allZones : [timezone, ...allZones]).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold">Brand color</legend>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`size-8 rounded-full ring-offset-2 ring-offset-[var(--background)] transition ${color === c ? "ring-2 ring-[var(--foreground)]" : ""}`}
                style={{ background: c }}
              />
            ))}
            <label htmlFor={ids.color} className="relative size-8 cursor-pointer overflow-hidden rounded-full border p-line" title="Custom color">
              <span className="sr-only">Custom color</span>
              <input
                id={ids.color}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span aria-hidden className="flex size-full items-center justify-center text-sm">+</span>
            </label>
          </div>
          <input type="hidden" name="brand_color" value={color} />
        </fieldset>
      </div>

      {/* Live preview of their site header */}
      <div aria-hidden className="overflow-hidden rounded-2xl border p-line">
        <div className="p-surface-2 flex items-center gap-2 px-3 py-2 text-xs p-muted">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-current opacity-30" />
            <span className="size-2 rounded-full bg-current opacity-30" />
            <span className="size-2 rounded-full bg-current opacity-30" />
          </span>
          <span className="truncate font-mono">{(slug || "yourname") + "." + domain}</span>
        </div>
        <div className="flex items-center justify-between gap-3 bg-white px-4 py-4 text-zinc-900">
          <span className="truncate text-lg font-extrabold tracking-tight" style={{ color }}>
            {name.trim() || "Your business"}
          </span>
          <span className="shrink-0 rounded-full px-4 py-2 text-sm font-bold text-white" style={{ background: color }}>
            Book now
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit || pending}
        className={pButton("primary", "lg", "w-full disabled:cursor-not-allowed disabled:opacity-50")}
      >
        {pending ? "Creating your site…" : "Create my business"}
      </button>
    </form>
  );
}
