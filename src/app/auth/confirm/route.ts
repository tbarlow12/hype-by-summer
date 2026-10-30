import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth-emails";

// Landing for our branded auth emails (lib/auth-emails.ts):
//   /auth/confirm?token_hash=…&type=magiclink|signup|invite|recovery|email&next=/path
// Verifying here sets the session cookie on this host (the business's site).
const TYPES = new Set<EmailOtpType>(["magiclink", "signup", "invite", "recovery", "email", "email_change"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/reset-password" : "/auth/continue";
  const dest = safeNext(searchParams.get("next"), fallback);
  if (tokenHash && type && TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${dest}`);
    console.warn("[auth/confirm] verify failed", type, error.message);
  }
  const retry = new URL("/login", origin);
  retry.searchParams.set("error", "link");
  if (dest !== "/auth/continue" && type !== "recovery") retry.searchParams.set("next", dest);
  return NextResponse.redirect(retry);
}
