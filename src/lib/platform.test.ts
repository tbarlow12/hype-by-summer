import { describe, expect, it } from "vitest";
import { classifyHost, isPlatformPath, sharedCookieDomain, tenantUrl } from "./platform";
import { brandPalette, contrast } from "./brand-palette";

describe("classifyHost", () => {
  const d = "trainer-os.com";
  it("recognises the platform's own hosts", () => {
    expect(classifyHost("trainer-os.com", d)).toEqual({ kind: "platform" });
    expect(classifyHost("WWW.trainer-os.com", d)).toEqual({ kind: "platform" });
    expect(classifyHost("app.trainer-os.com", d)).toEqual({ kind: "platform" });
    expect(classifyHost("", d)).toEqual({ kind: "platform" });
  });
  it("maps subdomains to tenant slugs", () => {
    expect(classifyHost("summer.trainer-os.com", d)).toEqual({ kind: "subdomain", slug: "summer" });
    expect(classifyHost("a.b.trainer-os.com", d)).toEqual({ kind: "platform" });
  });
  it("treats other hosts as custom domains", () => {
    expect(classifyHost("hypebysummer.com", d)).toEqual({ kind: "custom", domain: "hypebysummer.com" });
    expect(classifyHost("notreally-trainer-os.com", d)).toEqual({ kind: "custom", domain: "notreally-trainer-os.com" });
  });
  it("supports local dev with *.localhost subdomains", () => {
    expect(classifyHost("localhost:3000", "localhost:3000")).toEqual({ kind: "platform" });
    expect(classifyHost("summer.localhost:3000", "localhost:3000")).toEqual({ kind: "subdomain", slug: "summer" });
    expect(classifyHost("127.0.0.1:3000", "localhost:3000")).toEqual({ kind: "platform" });
  });
});

describe("tenantUrl", () => {
  it("prefers a verified custom domain", () => {
    expect(tenantUrl({ slug: "summer", custom_domain: "hype.fit", domain_verified_at: "2026-01-01" }, "/me", "x.com")).toBe("https://hype.fit/me");
    expect(tenantUrl({ slug: "summer", custom_domain: "hype.fit", domain_verified_at: null }, "/me", "x.com")).toBe("https://summer.x.com/me");
    expect(tenantUrl({ slug: "summer" }, "book", "localhost:3000")).toBe("http://summer.localhost:3000/book");
  });
});

describe("sharedCookieDomain", () => {
  it("shares cookies across platform subdomains only", () => {
    expect(sharedCookieDomain("summer.trainer-os.com", "trainer-os.com")).toBe(".trainer-os.com");
    expect(sharedCookieDomain("hype.fit", "trainer-os.com")).toBeNull();
    expect(sharedCookieDomain("summer.localhost:3000", "localhost:3000")).toBeNull();
  });
});

describe("isPlatformPath", () => {
  it("matches platform-only routes", () => {
    expect(isPlatformPath("/")).toBe(true);
    expect(isPlatformPath("/admin/tenants")).toBe(true);
    expect(isPlatformPath("/book")).toBe(false);
    expect(isPlatformPath("/pricingx")).toBe(false);
  });
});

describe("brandPalette", () => {
  it("keeps every pairing legible for any brand color", () => {
    for (const c of ["#e11d48", "#facc15", "#22c55e", "#0ea5e9", "#111111", "#ffffff", "#a855f7"]) {
      const p = brandPalette(c);
      expect(contrast(p.brand, p.onBrand)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.textLight, "#fafafa")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textDark, "#09090b")).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("puts dark text on light brand colors", () => {
    expect(brandPalette("#facc15").onBrand).toBe("#111111");
    expect(brandPalette("#e11d48").onBrand).toBe("#ffffff");
  });
  it("falls back to the default for invalid input", () => {
    expect(brandPalette("red").brand).toBe("#e11d48");
  });
});
