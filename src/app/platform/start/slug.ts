// Business address rules for trainer signup (<slug>.<platform domain>).
// Mirrors the businesses.slug check in the foundation migration, plus words
// that would collide with the platform's own pages or look official.

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

export const RESERVED_SLUGS = new Set([
  // In the database check constraint.
  "www", "app", "api", "admin", "auth", "mail", "help", "support", "status", "docs",
  "blog", "billing", "dashboard", "login", "signup", "static", "assets", "cdn",
  // Platform pages and infrastructure.
  "platform", "pricing", "start", "features", "legal", "terms", "privacy", "security", "about",
  "contact", "careers", "jobs", "press", "news", "account", "accounts", "settings", "coach", "me",
  "book", "booking", "checkout", "pay", "payments", "stripe", "webhooks", "webhook", "cron", "live",
  "free", "unsubscribe", "email", "emails", "smtp", "imap", "pop", "ftp", "ns1", "ns2", "dns", "mx",
  "test", "staging", "dev", "preview", "demo", "sandbox", "beta", "internal", "root", "system",
  "official", "team", "staff", "trainer", "trainers", "studio", "studios", "gym", "localhost",
]);

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41)
    .replace(/-+$/g, "");
}

/** A human message when the slug can't be used, else null. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 2) return "Use at least 2 characters.";
  if (slug.length > 41) return "Use at most 41 characters.";
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters, numbers and dashes, starting with a letter or number.";
  if (slug.includes("--") || slug.endsWith("-")) return "Avoid double dashes and a trailing dash.";
  if (RESERVED_SLUGS.has(slug)) return "That address is reserved. Try another.";
  return null;
}

/** Alternatives to offer when a slug is taken or reserved (valid ones only, in order). */
export function slugCandidates(base: string): string[] {
  const b = slugify(base).slice(0, 30).replace(/-+$/g, "") || "coach";
  const out = [b, `${b}-fit`, `${b}-training`, `${b}-coaching`, `train-with-${b}`, `${b}-pt`, `${b}-studio`];
  for (let i = 2; i <= 9; i++) out.push(`${b}${i}`);
  return [...new Set(out)].filter((s) => !slugProblem(s));
}
