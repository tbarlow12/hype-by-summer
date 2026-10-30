// Pure helpers for branded sign-in links (see invite.ts).

/** Only same-site, app-relative paths ("/me", "/coach/x"), never "//evil" or URLs. */
export function safeNextPath(next: string | null | undefined, fallback = "/me"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}

/** `${confirmUrl}?token_hash=…&type=magiclink&next=…` */
export function buildSignInUrl(confirmUrl: string, tokenHash: string, next = "/me"): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type: "magiclink", next: safeNextPath(next) });
  return `${confirmUrl}?${params.toString()}`;
}
