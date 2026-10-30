"use client";

import { useId, useState } from "react";
import { formatDollars, monthlyCost, type PlanPricing } from "../plans";

/** "What would I pay?" for a monthly volume of client payments. */
export function PlanCalculator({ pricing }: { pricing: PlanPricing }) {
  const id = useId();
  const [dollars, setDollars] = useState(1500);
  const cost = monthlyCost(dollars * 100, pricing);
  const cheaper = cost.starter <= cost.pro ? "starter" : "pro";
  return (
    <div className="p-surface rounded-3xl border p-line p-6 sm:p-8">
      <label htmlFor={id} className="font-display text-xl font-bold">
        Your clients pay you
      </label>
      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <span className="font-display text-4xl font-bold sm:text-5xl">{formatDollars(dollars * 100)}</span>
        <span className="p-muted">a month</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={15000}
        step={100}
        value={dollars}
        onChange={(e) => setDollars(Number(e.target.value))}
        className="mt-5 w-full accent-[var(--brand)]"
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-live="polite">
        {(["starter", "pro"] as const).map((plan) => (
          <div
            key={plan}
            className={`rounded-2xl border p-4 ${cheaper === plan ? "border-brand bg-[color-mix(in_oklab,var(--brand)_8%,transparent)]" : "p-line"}`}
          >
            <p className="text-sm font-semibold">
              {plan === "starter" ? "Starter" : "Pro"}
              {cheaper === plan ? <span className="ml-2 text-xs font-medium text-brand">Lower cost</span> : null}
            </p>
            <p className="mt-1 font-display text-2xl font-bold">{formatDollars(cost[plan])}<span className="text-sm font-normal p-muted"> /month</span></p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs p-muted">Platform cost only. Stripe&apos;s card processing fees apply on both plans.</p>
    </div>
  );
}
