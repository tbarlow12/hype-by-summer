"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getClientTrainerId, requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { notify } from "@/lib/notify";

// OWNER: leads. Client-submitted testimonials (moderated at /coach/testimonials).

const schema = z.object({
  author_name: zfd.requiredText("Add the name to show").pipe(z.string().max(80)),
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  body: zfd.requiredText("Write a few words").pipe(z.string().min(10, "Write at least a sentence").max(2000)),
  consent: zfd.checkbox(),
});

export async function submitTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireClient();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  if (!parsed.data.consent) return fail("Please confirm we can share your review on the website.");
  const trainerId = await getClientTrainerId(profile.id);
  if (!trainerId) return fail("You're not connected to a coach yet.");

  const supabase = await createClient();
  const { error } = await supabase.from("testimonials").insert({
    trainer_id: trainerId,
    client_id: profile.id,
    author_name: parsed.data.author_name,
    rating: parsed.data.rating,
    body: parsed.data.body,
    approved: false,
  });
  if (error) return fail("Couldn't submit your review. Please try again.");
  await notify({
    userId: trainerId,
    type: "testimonial_submitted",
    title: `New review from ${parsed.data.author_name}`,
    body: `${"★".repeat(parsed.data.rating)} ${parsed.data.body.slice(0, 140)}`,
    link: "/coach/testimonials",
  });
  revalidatePath("/coach/testimonials");
  return ok("Thank you! Your review was sent to your coach for approval.");
}
