import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { runSchedulingCron } from "@/lib/scheduling/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel Cron (every 15 min): expire holds, send reminders, notify waitlists, auto-complete past sessions. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const report = await runSchedulingCron();
  if (report.errors.length) console.error("[cron] scheduling errors", report.errors);
  return Response.json(report);
}
