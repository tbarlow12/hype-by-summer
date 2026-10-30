"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireClient } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";
import { notify } from "@/lib/notify";

// OWNER: leads. Client-submitted testimonials for the current business
// (moderated by its managers at /coach/testimonials).

const schema = z.object({
  author_name: zfd.requiredText("Add the name to show").pipe(z.string().max(80)),
  rating: z.coerce.number().int().min(1, "Pick a rating").max(5),
  body: zfd.requiredText("Write a few words").pipe(z.string().min(10, "Write at least a sentence").max(2000)),
  consent: zfd.checkbox(),
});

export async function submitTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, business } = await requireClient();
  const parsed = parseForm(schema, formData);
  if (parsed.error) return parsed.error;
  if (!parsed.data.consent) return fail("Please confirm we can share your review on the website.");

  // The review is about the client's primary coach (if any) at this business.
  const admin = createAdminClient();
  const { data: rel } = await admin
    .from("business_clients")
    .select("primary_coach_id")
    .eq("business_id", business.id)
    .eq("client_id", profile.id)
    .maybeSingle();
  const coachId = rel?.primary_coach_id ?? null;

  const supabase = await createClient();
  const { error } = await supabase.from("testimonials").insert({
    business_id: business.id,
    coach_id: coachId,
    client_id: profile.id,
    author_name: parsed.data.author_name,
    rating: parsed.data.rating,
    body: parsed.data.body,
    approved: false,
  });
  if (error) return fail("Couldn't submit your review. Please try again.");

  // Managers moderate; the client's coach hears about it too.
  const { data: managers } = await admin
    .from("business_members")
    .select("user_id")
    .eq("business_id", business.id)
    .eq("active", true)
    .in("role", ["owner", "admin"]);
  const recipients = new Set([...(managers ?? []).map((m) => m.user_id), ...(coachId ? [coachId] : [])]);
  await Promise.all(
    [...recipients].map((userId) =>
      notify({
        userId,
        businessId: business.id,
        type: "testimonial_submitted",
        title: `New review from ${parsed.data.author_name}`,
        body: `${"★".repeat(parsed.data.rating)} ${parsed.data.body.slice(0, 140)}`,
        link: "/coach/testimonials",
      }),
    ),
  );
  revalidatePath("/coach/testimonials");
  return ok("Thank you! Your review was sent for approval.");
}
