import { describe, expect, it } from "vitest";
import { apexOf, dnsPointsAtPlatform, dnsRecordsFor, isApexDomain, normalizeDomain, VERCEL_APEX_IP, VERCEL_CNAME } from "./domains";
import { FONT_PRESETS, brandContrastWarnings, monogram } from "./branding";
import { coachBreakdown, dashboardView, invitableRoles, slugify, teamChangeError } from "./team-utils";
import { isPublicMediaUrlIn, publicMediaPrefix } from "./media";

describe("custom domains", () => {
  const P = "trainer-os.com";
  it("normalises input", () => {
    expect(normalizeDomain("https://Book.MyStudio.com/path?x=1", P)).toEqual({ domain: "book.mystudio.com" });
    expect(normalizeDomain("mystudio.com.", P)).toEqual({ domain: "mystudio.com" });
    expect(normalizeDomain("www.mystudio.com:443", P)).toEqual({ domain: "www.mystudio.com" });
  });
  it("rejects junk and the platform's own hosts", () => {
    expect("error" in normalizeDomain("", P)).toBe(true);
    expect("error" in normalizeDomain("not a domain", P)).toBe(true);
    expect("error" in normalizeDomain("localhost", P)).toBe(true);
    expect("error" in normalizeDomain("summer.trainer-os.com", P)).toBe(true);
    expect("error" in normalizeDomain("trainer-os.com", P)).toBe(true);
    expect("error" in normalizeDomain("x.vercel.app", P)).toBe(true);
  });
  it("finds the apex, including two-part suffixes", () => {
    expect(apexOf("book.studio.com")).toBe("studio.com");
    expect(apexOf("book.studio.co.uk")).toBe("studio.co.uk");
    expect(isApexDomain("studio.co.uk")).toBe(true);
    expect(isApexDomain("www.studio.com")).toBe(false);
  });
  it("tells subdomains to CNAME and apexes to use an A record, plus TXT verification", () => {
    expect(dnsRecordsFor("book.studio.com")).toEqual([{ type: "CNAME", name: "book", value: VERCEL_CNAME }]);
    expect(dnsRecordsFor("studio.com")).toEqual([{ type: "A", name: "@", value: VERCEL_APEX_IP }]);
    const recs = dnsRecordsFor("book.studio.com", {
      verification: [{ type: "TXT", domain: "_vercel.studio.com", value: "vc-domain-verify=book.studio.com,abc" }],
      cname: "abc123.vercel-dns-017.com",
    });
    expect(recs[0]).toEqual({ type: "CNAME", name: "book", value: "abc123.vercel-dns-017.com" });
    expect(recs[1]).toMatchObject({ type: "TXT", name: "_vercel", value: "vc-domain-verify=book.studio.com,abc" });
  });
  it("checks DNS answers", () => {
    expect(dnsPointsAtPlatform("studio.com", { a: [VERCEL_APEX_IP] })).toBe(true);
    expect(dnsPointsAtPlatform("studio.com", { a: ["1.2.3.4"] })).toBe(false);
    expect(dnsPointsAtPlatform("book.studio.com", { cnames: ["cname.vercel-dns.com."] })).toBe(true);
    expect(dnsPointsAtPlatform("book.studio.com", { cnames: ["ghs.google.com"], a: ["1.2.3.4"] })).toBe(false);
  });
});

describe("branding", () => {
  it("warns about weak contrast only when it matters", () => {
    expect(brandContrastWarnings("#1d4ed8").filter((w) => w.level === "warn")).toEqual([]);
    expect(brandContrastWarnings("#fafafa").some((w) => w.message.includes("light background"))).toBe(true);
    expect(brandContrastWarnings("#0a0a0a").some((w) => w.message.includes("dark mode"))).toBe(true);
    // Mid-tone: palette adjusts brand text in at least one mode.
    expect(brandContrastWarnings("#e11d48").some((w) => w.level === "info")).toBe(true);
  });
  it("has the four DB font presets", () => {
    expect(FONT_PRESETS.map((f) => f.value)).toEqual(["athletic", "modern", "classic", "rounded"]);
  });
  it("builds monograms", () => {
    expect(monogram("HYPE by Summer")).toBe("HS");
    expect(monogram("Ironworks")).toBe("I");
    expect(monogram("The Strength Lab")).toBe("SL");
    expect(monogram("!!!")).toBe("?");
  });
});

describe("team rules", () => {
  const owner = "o", admin = "a", coach = "c";
  it("only owners touch owners", () => {
    expect(teamChangeError({ actorId: admin, actorRole: "admin", targetId: coach, targetRole: "coach", nextRole: "owner" })).toMatch(/owner/);
    expect(teamChangeError({ actorId: admin, actorRole: "admin", targetId: owner, targetRole: "owner", nextRole: "coach" })).toMatch(/owner/);
    expect(teamChangeError({ actorId: admin, actorRole: "admin", targetId: owner, targetRole: "owner", deactivate: true })).toMatch(/owner/);
    expect(teamChangeError({ actorId: owner, actorRole: "owner", targetId: admin, targetRole: "admin", nextRole: "owner" })).toBeNull();
    // Editing an owner's title/bookable (no role change) is fine for admins.
    expect(teamChangeError({ actorId: admin, actorRole: "admin", targetId: owner, targetRole: "owner", nextRole: "owner" })).toBeNull();
  });
  it("prevents self-lockout and non-managers", () => {
    expect(teamChangeError({ actorId: admin, actorRole: "admin", targetId: admin, targetRole: "admin", deactivate: true })).toMatch(/yourself/);
    expect(teamChangeError({ actorId: admin, actorRole: "admin", targetId: admin, targetRole: "admin", nextRole: "coach" })).toMatch(/own management/);
    expect(teamChangeError({ actorId: coach, actorRole: "coach", targetId: "x", targetRole: "staff", nextRole: "coach" })).toMatch(/Only owners and admins/);
    expect(invitableRoles("owner")).toContain("owner");
    expect(invitableRoles("admin")).not.toContain("owner");
    expect(invitableRoles("coach")).toEqual([]);
  });
  it("defaults the dashboard scope by role", () => {
    expect(dashboardView(undefined, false)).toBe("me");
    expect(dashboardView(undefined, true)).toBe("team");
    expect(dashboardView("team", false)).toBe("team");
    expect(dashboardView("bogus", true)).toBe("team");
  });
  it("breaks numbers down per coach", () => {
    const rows = coachBreakdown({
      coachIds: ["c1", "c2"],
      today: [{ coach_id: "c1" }],
      week: [{ coach_id: "c1" }, { coach_id: "c1" }, { coach_id: "c2" }],
      clients: [
        { primary_coach_id: "c1", status: "active" },
        { primary_coach_id: "c1", status: "archived" },
        { primary_coach_id: null, status: "active" },
      ],
      leads: [{ assigned_coach_id: "c2" }, { assigned_coach_id: null }],
      revenue: [{ coach_id: "c2", net_cents: 9000 }, { coach_id: null, net_cents: 100 }],
    });
    expect(rows).toEqual([
      { coachId: "c1", sessionsToday: 1, sessionsWeek: 2, activeClients: 1, openLeads: 0, revenueCents: 0 },
      { coachId: "c2", sessionsToday: 0, sessionsWeek: 1, activeClients: 0, openLeads: 1, revenueCents: 9000 },
    ]);
    expect(coachBreakdown({ coachIds: ["c1"], today: [], week: [], clients: [], leads: [] })[0]!.revenueCents).toBeNull();
  });
  it("slugifies names", () => {
    expect(slugify("Summer Smith")).toBe("summer-smith");
    expect(slugify("  José  Ñúñez! ")).toBe("jose-nunez");
    expect(slugify("---")).toBe("");
  });
});

describe("media folders", () => {
  it("accepts only files in the given folder", () => {
    const biz = "b0000000-0000-0000-0000-000000000001";
    expect(isPublicMediaUrlIn(`${publicMediaPrefix(biz)}logo-1.png`, biz)).toBe(true);
    expect(isPublicMediaUrlIn(`${publicMediaPrefix("other")}logo.png`, biz)).toBe(false);
    expect(isPublicMediaUrlIn(`${publicMediaPrefix(biz)}../x.png`, biz)).toBe(false);
  });
});
