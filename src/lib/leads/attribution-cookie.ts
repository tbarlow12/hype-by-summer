// Encoding for the first-party `hbs_attr` cookie (client + server safe, pure).
// Shape: { v: 1, ft: Touch, lt?: Touch } where ft = first touch (never
// overwritten) and lt = most recent campaign touch.

export const ATTR_COOKIE = "hbs_attr";
export const ATTR_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export type Touch = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_page?: string;
  ts?: string;
};

export type AttrCookie = { v: 1; ft: Touch; lt?: Touch };

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const TOUCH_KEYS = [...UTM_KEYS, "referrer", "landing_page", "ts"] as const;
const MAX_LEN = 300;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strip control characters and cap the length.
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_LEN);
  return v || undefined;
}

function cleanTouch(raw: unknown): Touch | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Touch = {};
  for (const key of TOUCH_KEYS) {
    const v = clean((raw as Record<string, unknown>)[key]);
    if (v) out[key] = v;
  }
  if (out.ts && Number.isNaN(Date.parse(out.ts))) delete out.ts;
  return Object.keys(out).length ? out : undefined;
}

/** Parse a raw cookie value; returns null when absent or malformed. */
export function parseAttrCookie(raw: string | undefined | null): AttrCookie | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.startsWith("{") ? raw : decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const ft = cleanTouch((json as Record<string, unknown>).ft);
  if (!ft) return null;
  const lt = cleanTouch((json as Record<string, unknown>).lt);
  return lt ? { v: 1, ft, lt } : { v: 1, ft };
}

export function serializeAttrCookie(value: AttrCookie): string {
  return encodeURIComponent(JSON.stringify(value));
}

/** Only keeps the referrer when it's another site (internal navigation isn't a source). */
export function externalReferrer(referrer: string | undefined, currentHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    return url.host === currentHost ? undefined : clean(url.origin + url.pathname);
  } catch {
    return undefined;
  }
}

/** Build the touch for the current page view from its URL and document.referrer. */
export function touchFromVisit(href: string, referrer: string | undefined, now: Date): Touch {
  const url = new URL(href);
  const touch: Touch = {};
  for (const key of UTM_KEYS) {
    const v = clean(url.searchParams.get(key));
    if (v) touch[key] = v;
  }
  const ref = externalReferrer(referrer, url.host);
  if (ref) touch.referrer = ref;
  touch.landing_page = clean(url.pathname + url.search);
  touch.ts = now.toISOString();
  return touch;
}

const isCampaignTouch = (t: Touch) => UTM_KEYS.some((k) => t[k]) || Boolean(t.referrer);

/**
 * Merge a visit into the existing cookie. First touch is never overwritten;
 * last touch moves only for visits that carry UTM params or an external
 * referrer. Returns null when nothing needs to be written.
 */
export function mergeVisit(existing: AttrCookie | null, visit: Touch): AttrCookie | null {
  if (!existing) return isCampaignTouch(visit) ? { v: 1, ft: visit, lt: visit } : { v: 1, ft: visit };
  if (!isCampaignTouch(visit)) return null;
  return { ...existing, lt: visit };
}
