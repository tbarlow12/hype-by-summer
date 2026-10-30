import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMembership, getProfile } from "@/lib/auth";
import { ensureClientLinked } from "@/lib/onboarding";
import { getBusiness } from "@/lib/tenant";
import { CheckoutError, createOfferingCheckout } from "@/lib/payments/checkout";

/**
 * GET /checkout/start?offering=<id>
 * Buying requires an account: signed-out visitors go to sign-up and come back
 * here afterwards, then we hand them to Stripe Checkout on this business's
 * account. Only this business's offerings can be bought here.
 */
export async function GET(request: NextRequest) {
  const business = await getBusiness();
  if (!business) return new NextResponse("Not found", { status: 404 });
  const offering = z.uuid().safeParse(request.nextUrl.searchParams.get("offering"));
  if (!offering.success) return NextResponse.redirect(new URL("/pricing", request.url), 303);

  const here = `/checkout/start?offering=${offering.data}`;
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.redirect(new URL(`/signup?next=${encodeURIComponent(here)}`, request.url), 303);
  }
  if (await getMembership()) {
    // Staff preview the pricing page; they don't buy from their own business.
    return NextResponse.redirect(new URL("/coach/offerings", request.url), 303);
  }

  try {
    await ensureClientLinked(profile, business.id);
    const { url } = await createOfferingCheckout(business.id, offering.data, profile.id);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    if (err instanceof CheckoutError && err.code === "already_subscribed") {
      return NextResponse.redirect(new URL("/me/billing?notice=already_subscribed", request.url), 303);
    }
    console.error("[checkout] start failed", err);
    const message = err instanceof CheckoutError ? err.message : "We couldn't start checkout. Please try again.";
    return NextResponse.redirect(new URL(`/pricing?error=${encodeURIComponent(message)}`, request.url), 303);
  }
}
