import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

// Building blocks for the platform's own pages (not the trainer-site UI kit).

export function pButton(variant: "primary" | "ink" | "ghost" | "outline" = "primary", size: "md" | "lg" = "md", extra?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition-[background,transform,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:translate-y-px",
    size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm",
    {
      primary: "bg-brand text-on-brand shadow-[0_8px_24px_-12px_var(--brand)] hover:bg-brand-dark",
      ink: "p-ink hover:opacity-90",
      ghost: "hover:bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]",
      outline: "border p-line hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]",
    }[variant],
    extra,
  );
}

export function PLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: "primary" | "ink" | "ghost" | "outline"; size?: "md" | "lg" }) {
  return <Link className={pButton(variant, size, className)} {...props} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx("text-xs font-semibold uppercase tracking-[0.18em] text-brand", className)}>{children}</p>
  );
}

export function Section({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={clsx("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>
      {children}
    </section>
  );
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("p-surface rounded-3xl border p-line", className)} {...props} />;
}

export function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={clsx("size-5 shrink-0 text-brand", className)}>
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.12" />
      <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
