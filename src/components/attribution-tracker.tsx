"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ATTR_COOKIE,
  ATTR_MAX_AGE_SECONDS,
  mergeVisit,
  parseAttrCookie,
  serializeAttrCookie,
  touchFromVisit,
} from "@/lib/leads/attribution-cookie";

const PRIVATE = ["/coach", "/me", "/auth", "/api"];

// document.referrer only describes the full page load, not client-side navigations.
let initialLoad = true;

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(prefix))
    ?.slice(prefix.length);
}

/**
 * Stores first-touch marketing attribution (UTM params, referrer, landing page,
 * timestamp) in the first-party `hbs_attr` cookie for 90 days, never
 * overwriting it, and keeps the most recent campaign touch alongside.
 * Renders nothing. Mounted once in the root layout.
 */
export function AttributionTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();

  useEffect(() => {
    if (PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    try {
      const existing = parseAttrCookie(readCookie(ATTR_COOKIE));
      const referrer = initialLoad ? document.referrer : "";
      initialLoad = false;
      const next = mergeVisit(existing, touchFromVisit(window.location.href, referrer, new Date()));
      if (!next) return;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${ATTR_COOKIE}=${serializeAttrCookie(next)}; Path=/; Max-Age=${ATTR_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
    } catch {
      // Cookies disabled: attribution is best-effort.
    }
  }, [pathname, query]);

  return null;
}
