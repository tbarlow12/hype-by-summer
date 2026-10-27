import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth / magic-link (PKCE) landing: exchange the code for a session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const dest = next?.startsWith("/") && !next.startsWith("//") ? next : "/auth/continue";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${dest}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
