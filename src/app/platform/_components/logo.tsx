import { PLATFORM_NAME } from "@/lib/platform";

/** The platform's wordmark: a stacked-bars mark + name. */
export function PlatformLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 28 28" aria-hidden className="size-7 shrink-0">
        <rect width="28" height="28" rx="8" fill="var(--p-ink)" />
        <rect x="7" y="15" width="3.5" height="6" rx="1.2" fill="var(--p-accent)" />
        <rect x="12.25" y="10.5" width="3.5" height="10.5" rx="1.2" fill="var(--p-on-ink)" />
        <rect x="17.5" y="6.5" width="3.5" height="14.5" rx="1.2" fill="var(--p-on-ink)" />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight">{PLATFORM_NAME}</span>
    </span>
  );
}
