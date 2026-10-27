import "server-only";
import { cookies, headers } from "next/headers";
import { ATTR_COOKIE, parseAttrCookie, type Touch } from "@/lib/leads/attribution-cookie";

// OWNER: leads. First-touch marketing attribution captured on the first visit
// (UTM params, referrer, landing page) and stored in a first-party cookie
// by <AttributionTracker /> (src/components/attribution-tracker.tsx).

export type LastTouch = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrerUrl?: string;
  landingPage?: string;
  at?: string;
};

export type Attribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrerUrl?: string;
  landingPage?: string;
  firstSeenAt?: string;
  /** Most recent campaign visit (UTM or external referrer), if any. */
  lastTouch?: LastTouch;
};

function fromTouch(t: Touch): LastTouch {
  return {
    utmSource: t.utm_source,
    utmMedium: t.utm_medium,
    utmCampaign: t.utm_campaign,
    utmTerm: t.utm_term,
    utmContent: t.utm_content,
    referrerUrl: t.referrer,
    landingPage: t.landing_page,
    at: t.ts,
  };
}

/** Pure mapping from the raw cookie value (exported for reuse/tests). */
export function attributionFromCookie(raw: string | undefined): Attribution {
  const parsed = parseAttrCookie(raw);
  if (!parsed) return {};
  const { at, ...first } = fromTouch(parsed.ft);
  return { ...first, firstSeenAt: at, lastTouch: parsed.lt ? fromTouch(parsed.lt) : undefined };
}

/** Reads the attribution cookie for the current request ({} if absent). */
export async function readAttribution(): Promise<Attribution> {
  const store = await cookies();
  const attribution = attributionFromCookie(store.get(ATTR_COOKIE)?.value);
  if (attribution.landingPage) return attribution;
  // No cookie (JS blocked / first request is the form post): fall back to the
  // page that submitted the form.
  const referer = (await headers()).get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      attribution.landingPage = (url.pathname + url.search).slice(0, 300);
      for (const [key, prop] of [
        ["utm_source", "utmSource"],
        ["utm_medium", "utmMedium"],
        ["utm_campaign", "utmCampaign"],
        ["utm_term", "utmTerm"],
        ["utm_content", "utmContent"],
      ] as const) {
        const v = url.searchParams.get(key)?.slice(0, 300);
        if (v && !attribution[prop]) attribution[prop] = v;
      }
    } catch {
      // ignore malformed referer
    }
  }
  return attribution;
}
