import { NextResponse, type NextRequest } from "next/server";
import { getProfile, homeFor } from "@/lib/auth";

// Post-login router: staff to /coach, clients to /me (per this site's business).
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  return NextResponse.redirect(new URL(profile ? await homeFor() : "/login", request.url));
}
