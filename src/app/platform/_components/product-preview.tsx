// Illustration of a trainer's branded site + coach dashboard. Fictional, generic
// brand ("Your Brand"); never a real customer.

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function ProductPreview() {
  const brand = "#0f766e";
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md select-none lg:max-w-none">
      {/* Dashboard card */}
      <div className="p-surface absolute -left-2 top-6 hidden w-64 rounded-2xl border p-line p-4 shadow-2xl sm:block lg:-left-10">
        <p className="text-[11px] font-semibold uppercase tracking-wider p-muted">This month</p>
        <p className="mt-1 font-display text-3xl font-bold">$8,420</p>
        <div className="mt-3 flex h-16 items-end gap-1.5">
          {[38, 52, 44, 61, 58, 72, 66, 84, 79, 92].map((h, i) => (
            <span key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i === 9 ? brand : "color-mix(in oklab, currentColor 14%, transparent)" }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          {[["42", "sessions"], ["18", "members"], ["7", "new leads"]].map(([n, l]) => (
            <div key={l} className="p-surface-2 rounded-lg py-1.5">
              <p className="font-display text-base font-bold">{n}</p>
              <p className="p-muted">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Phone */}
      <div className="relative ml-auto w-[min(100%,300px)] rounded-[2.4rem] border-[10px] border-[#0d0e14] bg-white text-zinc-900 shadow-[0_40px_80px_-30px_rgba(13,14,20,0.55)] sm:mr-4">
        <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-zinc-200" />
        <div className="px-4 pb-5 pt-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight" style={{ color: brand }}>
              <span className="size-5 rounded-md" style={{ background: brand }} /> Your Brand
            </span>
            <span className="size-7 rounded-full bg-zinc-100" />
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Book a session</p>
          <p className="mt-0.5 text-lg font-bold leading-tight">1:1 Strength · 60 min</p>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] text-zinc-500">
            {DAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {Array.from({ length: 14 }, (_, i) => (
              <span
                key={i}
                className="flex aspect-square items-center justify-center rounded-full text-[11px] font-medium"
                style={i === 9 ? { background: brand, color: "#fff" } : { color: i % 7 > 4 ? "#a1a1aa" : "#18181b" }}
              >
                {i + 8}
              </span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {["7:00", "8:30", "12:00", "17:30", "18:30", "19:30"].map((t, i) => (
              <span
                key={t}
                className="rounded-lg border py-1.5 text-center text-xs font-semibold"
                style={i === 3 ? { background: brand, borderColor: brand, color: "#fff" } : { borderColor: "#e4e4e7" }}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-zinc-50 p-3">
            <p className="text-[11px] font-semibold text-zinc-500">Today&apos;s workout</p>
            <p className="text-sm font-bold">Lower body A · Week 3</p>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-200">
              <div className="h-1.5 w-2/3 rounded-full" style={{ background: brand }} />
            </div>
          </div>
          <span className="mt-4 block rounded-full py-2.5 text-center text-sm font-bold text-white" style={{ background: brand }}>
            Confirm &amp; pay
          </span>
        </div>
      </div>

      {/* Chat bubble */}
      <div className="p-surface absolute -bottom-4 left-4 hidden max-w-[220px] rounded-2xl rounded-bl-sm border p-line px-4 py-3 text-sm shadow-xl sm:block lg:left-0">
        <p className="text-[11px] font-semibold p-muted">Form check · 0:14</p>
        <p className="mt-0.5">Great depth! Keep your chest up out of the hole.</p>
      </div>
    </div>
  );
}
