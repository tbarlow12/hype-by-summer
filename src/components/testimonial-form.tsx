"use client";

import { useId, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Textarea, cn } from "@/components/ui";
import { submitTestimonial } from "@/lib/testimonials";

/**
 * Lets a signed-in client leave a review for their coach. Reviews stay hidden
 * until the coach approves them at /coach/testimonials.
 */
export function TestimonialForm({ defaultName }: { defaultName?: string | null }) {
  const id = useId();
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? rating;
  const suggested = defaultName ? defaultName.split(/\s+/).map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ") : "";

  return (
    <ActionForm action={submitTestimonial} resetOnSuccess className="flex flex-col gap-4">
      <fieldset>
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Your rating</legend>
        <input type="hidden" name="rating" value={rating} />
        <div className="mt-1 flex gap-1" onMouseLeave={() => setHover(null)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              aria-pressed={rating === n}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              className="rounded p-0.5 focus-visible:outline-2 focus-visible:outline-brand"
            >
              <svg viewBox="0 0 20 20" className={cn("size-8", n <= shown ? "text-amber-400" : "text-zinc-300 dark:text-zinc-700")} fill="currentColor" aria-hidden="true">
                <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
              </svg>
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Your review" htmlFor={`${id}-body`}>
        <Textarea
          id={`${id}-body`}
          name="body"
          rows={4}
          required
          minLength={10}
          maxLength={2000}
          placeholder="What changed for you since you started training? What do you enjoy most?"
        />
      </Field>
      <Field label="Name to display" htmlFor={`${id}-name`} hint="First name and last initial is perfect.">
        <Input id={`${id}-name`} name="author_name" required maxLength={80} defaultValue={suggested} />
      </Field>
      <Checkbox name="consent" required label="I'm happy for this review to appear on the website." />
      <div>
        <SubmitButton pendingLabel="Sending…">Submit review</SubmitButton>
      </div>
    </ActionForm>
  );
}
