import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import { classifyHost, isPlatformPath, sharedCookieDomain } from "@/lib/platform";

const PROTECTED_PREFIXES = ["/coach", "/me", "/onboarding", "/platform/admin"];
/** Pages that only make sense on a trainer's site. */
const TENANT_ONLY_PREFIXES = ["/book", "/booking", "/free", "/me", "/live", "/unsubscribe", "/checkout"];

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Routes each request to the platform site or a trainer's site by host,
 * refreshes the Supabase session cookie, and bounces signed-out users from
 * private areas.
 */
export async function updateSession(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const kind = classifyHost(host).kind;
  const { pathname, search } = request.nextUrl;

  // Platform-only internals are never reachable directly.
  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    return new NextResponse("Not found", { status: 404 });
  }

  let rewriteTo: URL | null = null;
  if (kind === "platform") {
    if (isPlatformPath(pathname)) {
      rewriteTo = request.nextUrl.clone();
      rewriteTo.pathname = pathname === "/" ? "/platform" : `/platform${pathname}`;
    } else if (startsWithAny(pathname, TENANT_ONLY_PREFIXES)) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
  }

  const effectivePath = rewriteTo?.pathname ?? pathname;
  const respond = () => (rewriteTo ? NextResponse.rewrite(rewriteTo, { request }) : NextResponse.next({ request }));
  let response = respond();
  const domain = sharedCookieDomain(host) ?? undefined;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: domain ? { domain } : undefined,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = respond();
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && startsWithAny(effectivePath, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}
