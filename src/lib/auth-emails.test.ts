import { describe, expect, it } from "vitest";
import { confirmUrl, safeNext } from "./auth-emails";

describe("auth email links", () => {
  it("keeps next on the same site", () => {
    expect(safeNext("/coach")).toBe("/coach");
    expect(safeNext("//evil.com")).toBe("/auth/continue");
    expect(safeNext("/\\evil.com")).toBe("/auth/continue");
    expect(safeNext("https://evil.com")).toBe("/auth/continue");
    expect(safeNext(undefined, "/me")).toBe("/me");
  });
  it("builds /auth/confirm links on the given site", () => {
    const url = new URL(confirmUrl("https://peak.trainer-os.com/", "abc123", "signup", "/me?x=1"));
    expect(url.origin + url.pathname).toBe("https://peak.trainer-os.com/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.get("next")).toBe("/me?x=1");
    expect(new URL(confirmUrl("http://a.localhost:3000", "t", "recovery", "//x")).searchParams.get("next")).toBe("/auth/continue");
  });
});
