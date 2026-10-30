import { describe, expect, it } from "vitest";
import type { Brand } from "@/lib/tenant";
import { broadcastEmail, unsubscribeHeaders, unsubscribeUrl } from "./broadcast";
import { newMessageEmail } from "./new-message";
import { videoReviewedEmail } from "./video-reviewed";

const brand: Brand = {
  name: "Iron Studio",
  logoUrl: null,
  palette: {} as Brand["palette"],
  siteUrl: "https://iron.example.com/",
  replyTo: "hello@iron.example.com",
  businessId: "b1",
  timezone: "America/Denver",
};

describe("branded comms emails", () => {
  it("links leads to the business's own unsubscribe page", () => {
    expect(unsubscribeUrl(brand, "tok123")).toBe("https://iron.example.com/unsubscribe/tok123");
    expect(unsubscribeHeaders(brand, "tok123")).toEqual({ "List-Unsubscribe": "<https://iron.example.com/unsubscribe/tok123>" });
    expect(unsubscribeHeaders(brand, null)).toBeUndefined();
    const e = broadcastEmail({ brand, to: "lee@example.com", subject: "Hi", body: "One\n\nTwo", senderName: "Sam", firstName: "Lee Park", unsubscribeToken: "tok123" });
    expect(e.brand).toBe(brand);
    expect(e.paragraphs).toEqual(["Hi Lee,", "One", "Two", "— Sam, Iron Studio"]);
    expect(e.footerNote).toContain("signed up with Iron Studio");
    expect(e.footerNote).toContain("https://iron.example.com/unsubscribe/tok123");
  });
  it("tells clients the update is from their business, without unsubscribe", () => {
    const e = broadcastEmail({ brand, to: "c@example.com", subject: "Holiday hours", body: "Closed Monday", senderName: "Iron Studio" });
    expect(e.paragraphs.at(-1)).toBe("— Iron Studio");
    expect(e.footerNote).toBe("You're receiving this because you train with Iron Studio.");
  });
  it("builds absolute links on the business site", () => {
    const m = newMessageEmail({ brand, to: "c@example.com", senderName: "Sam (Iron Studio)", preview: "x".repeat(300), link: "/me/messages" });
    expect(m.cta?.url).toBe("https://iron.example.com/me/messages");
    expect(m.paragraphs[1]!.length).toBeLessThan(285);
    expect(m.footerNote).toContain("Iron Studio");
    const v = videoReviewedEmail({ brand, to: "c@example.com", coachName: "Sam", videoTitle: "Squat", commentCount: 1, submissionId: "v1" });
    expect(v.cta?.url).toBe("https://iron.example.com/me/videos/v1");
    expect(v.paragraphs[1]).toContain("1 coaching note is waiting");
  });
});
