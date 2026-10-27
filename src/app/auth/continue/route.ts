import { NextResponse, type NextRequest } from "next/server";
import { getProfile, homeFor } from "@/lib/auth";

// Post-login router: send each role to its home.
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  return NextResponse.redirect(new URL(profile ? homeFor(profile) : "/login", request.url));
}
