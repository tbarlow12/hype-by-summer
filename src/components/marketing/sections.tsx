import type { ReactNode } from "react";
import { cn } from "@/components/ui";

// Small presentational building blocks shared by public marketing pages.

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
  tone = "light",
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "light" | "muted" | "dark";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24",
        tone === "muted" && "bg-zinc-50 dark:bg-zinc-900/40",
        tone === "dark" && "bg-zinc-950 text-white",
        className,
      )}
    >
      <div className="mx-auto max-w-6xl">
        {eyebrow || title || intro ? (
          <div className="mb-10 max-w-2xl sm:mb-14">
            {eyebrow ? <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">{eyebrow}</p> : null}
            {title ? <h2 className="mt-2 text-3xl font-black tracking-tight text-balance sm:text-5xl">{title}</h2> : null}
            {intro ? (
              <p className={cn("mt-4 text-lg", tone === "dark" ? "text-zinc-300" : "text-zinc-600 dark:text-zinc-400")}>{intro}</p>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={cn("size-5 shrink-0 text-brand", className)}>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Stars({ rating, className }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span className={cn("inline-flex gap-0.5 text-amber-400", className)} role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className={cn("size-4", i > full && "text-zinc-300 dark:text-zinc-700")} fill="currentColor" aria-hidden="true">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
        </svg>
      ))}
    </span>
  );
}

/** Book-cover style placeholder when a lead magnet has no cover image. */
export function GuideCover({ title, src, className, small = false }: { title: string; src?: string | null; className?: string; small?: boolean }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={`Cover of ${title}`} className={cn("aspect-[3/4] w-full rounded-2xl object-cover shadow-2xl", className)} />
    );
  }
  return (
    <div
      className={cn(
        "relative flex aspect-[3/4] w-full flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-brand via-brand-dark to-zinc-900 text-white shadow-2xl",
        small ? "p-2" : "p-6",
        className,
      )}
      role="img"
      aria-label={`Cover of ${title}`}
    >
      <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10" aria-hidden="true" />
      <div className="absolute -bottom-16 -left-8 size-48 rounded-full bg-black/20" aria-hidden="true" />
      {small ? null : (
        <span className="relative w-fit rounded-full bg-black/35 px-3 py-1 text-xs font-bold uppercase tracking-widest text-white">Free PDF</span>
      )}
      <p className={cn("relative font-black leading-tight tracking-tight text-balance", small ? "line-clamp-5 text-[0.7rem]" : "text-2xl sm:text-3xl")}>
        {title}
      </p>
    </div>
  );
}

export const LOCATION_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Online",
  phone: "Phone call",
  client_location: "At your place",
};
