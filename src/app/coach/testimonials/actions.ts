"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, zfd, type ActionState } from "@/lib/actions";

// Reviews shown on the business's public site; any staff member of the
// business can moderate them (RLS: is_member).

const refresh = () => {
  revalidatePath("/coach/testimonials");
  revalidatePath("/");
  revalidatePath("/free", "layout");
};

export async function setTestimonialApproved(formData: FormData): Promise<void> {
  const { business } = await requireStaff();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase
    .from("testimonials")
    .update({ approved: formData.get("approved") === "true" })
    .eq("id", id.data)
    .eq("business_id", business.id);
  refresh();
}

export async function deleteTestimonial(formData: FormData): Promise<void> {
  const { business } = await requireStaff();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.from("testimonials").delete().eq("id", id.data).eq("business_id", business.id);
  refresh();
}

const addSchema = z.object({
  author_name: zfd.requiredText("Add a name").pipe(z.string().max(80)),
  rating: zfd.optionalInt().pipe(z.number().int().min(1).max(5).optional()),
  body: zfd.requiredText("Add the review text").pipe(z.string().max(2000)),
  approved: zfd.checkbox(),
});

export async function addTestimonial(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business, profile, membership } = await requireStaff();
  const parsed = parseForm(addSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.from("testimonials").insert({
    business_id: business.id,
    // A coach's review is about them; owners/admins add business-wide reviews.
    coach_id: membership.role === "coach" ? profile.id : null,
    author_name: parsed.data.author_name,
    rating: parsed.data.rating ?? null,
    body: parsed.data.body,
    approved: parsed.data.approved,
  });
  if (error) return fail(error.message);
  refresh();
  return ok("Testimonial added.");
}
