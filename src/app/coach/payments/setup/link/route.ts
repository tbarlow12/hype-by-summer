import { NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { createOnboardingLink } from "@/lib/payments/accounts";

/**
 * GET /coach/payments/setup/link: a fresh Stripe onboarding link for the
 * business's existing account. Stripe sends managers here when a link
 * expires (refresh_url). Never creates an account (that's a POST action).
 */
export async function GET(request: Request) {
  const { business } = await requireManager();
  if (!business.stripe_account_id) return NextResponse.redirect(new URL("/coach/payments/setup", request.url), 303);
  try {
    return NextResponse.redirect(await createOnboardingLink(business), 303);
  } catch (err) {
    console.error("[payments] onboarding link failed", err);
    return NextResponse.redirect(new URL("/coach/payments/setup?error=link", request.url), 303);
  }
}
