import { NextResponse, type NextRequest } from "next/server";
import { recordLeadEvent, verifyDownloadTokenValue } from "@/lib/leads";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientInfoFromHeaders } from "@/lib/leads/headers";

// GET /api/lead-magnets/download?token=… — verifies the signed link, logs the
// download, then redirects to a short-lived signed Storage URL for the PDF.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const verified = verifyDownloadTokenValue(token);
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/free?download=${reason}`, request.nextUrl.origin), { status: 303 });
  if (!verified.ok) return fail(verified.reason);

  const { leadId, magnetId } = verified.claims;
  const admin = createAdminClient();
  const [{ data: magnet }, { data: lead }] = await Promise.all([
    admin.from("lead_magnets").select("id, trainer_id, slug, title, file_path").eq("id", magnetId).maybeSingle(),
    admin.from("leads").select("id, trainer_id").eq("id", leadId).maybeSingle(),
  ]);
  if (!magnet?.file_path || !lead || lead.trainer_id !== magnet.trainer_id) return fail("unavailable");

  const filename = `${magnet.slug}.pdf`;
  const { data: signed, error } = await admin.storage
    .from("lead-magnets")
    .createSignedUrl(magnet.file_path, 300, { download: filename });
  if (error || !signed) {
    console.error("[lead-magnets] signed url failed", error);
    return fail("unavailable");
  }

  // Link-preview bots (Slack, iMessage, mail scanners) issue HEAD/GET without a
  // browser UA; still serve them but don't count it as a download.
  const info = clientInfoFromHeaders(request.headers);
  const isBot = !info.userAgent || /bot|crawler|spider|preview|scanner|slurp|facebookexternalhit/i.test(info.userAgent);
  if (!isBot) {
    try {
      const { count } = await admin
        .from("lead_events")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("type", "magnet_downloaded")
        .eq("detail->>lead_magnet_id", magnet.id);
      // recordLeadEvent re-scores; the first download for this lead bumps the score.
      await recordLeadEvent(lead.id, "magnet_downloaded", {
        lead_magnet_id: magnet.id,
        slug: magnet.slug,
        first: (count ?? 0) === 0,
        country: info.country ?? null,
      });
    } catch (err) {
      console.error("[lead-magnets] failed to log download", err);
    }
  }

  return NextResponse.redirect(signed.signedUrl, { status: 303 });
}
