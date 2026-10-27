import { describe, expect, it } from "vitest";
import {
  dayLabel,
  fileExtension,
  formatClock,
  isEmbeddableRoom,
  isOwnPath,
  kindForMime,
  linkify,
  markerPercent,
  messagePreview,
  programDayFor,
  sessionClock,
  shouldEmailRecipient,
  uploadPath,
  validateUpload,
} from "./policy";

const now = new Date("2026-10-27T18:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("shouldEmailRecipient", () => {
  it("emails when the recipient has never read or been emailed", () => {
    expect(shouldEmailRecipient({ lastReadAt: null, lastEmailedAt: null, now })).toBe(true);
  });
  it("skips when they read the thread in the last 10 minutes", () => {
    expect(shouldEmailRecipient({ lastReadAt: minsAgo(3), lastEmailedAt: null, now })).toBe(false);
  });
  it("emails once per unread streak", () => {
    expect(shouldEmailRecipient({ lastReadAt: minsAgo(60), lastEmailedAt: null, now })).toBe(true);
    expect(shouldEmailRecipient({ lastReadAt: minsAgo(60), lastEmailedAt: minsAgo(30), now })).toBe(false);
    expect(shouldEmailRecipient({ lastReadAt: minsAgo(20), lastEmailedAt: minsAgo(30), now })).toBe(true);
  });
  it("nudges again after a day without reading", () => {
    expect(shouldEmailRecipient({ lastReadAt: null, lastEmailedAt: minsAgo(60 * 25), now })).toBe(true);
    expect(shouldEmailRecipient({ lastReadAt: null, lastEmailedAt: minsAgo(60), now })).toBe(false);
  });
});

describe("uploads", () => {
  it("derives extensions", () => {
    expect(fileExtension("IMG_1.HEIC", "image/heic")).toBe("heic");
    expect(fileExtension("blob", "video/quicktime")).toBe("mov");
    expect(fileExtension("weird", "application/x-thing")).toBe("bin");
  });
  it("validates size and type", () => {
    expect(validateUpload("form-videos", { size: 10, contentType: "image/png" }).ok).toBe(false);
    expect(validateUpload("form-videos", { size: 501 * 1024 * 1024, contentType: "video/mp4" }).ok).toBe(false);
    expect(validateUpload("form-videos", { size: 400 * 1024 * 1024, contentType: "video/mp4" }).ok).toBe(true);
    expect(validateUpload("chat-media", { size: 0, contentType: "image/png" }).ok).toBe(false);
  });
  it("builds and checks owner paths", () => {
    const p = uploadPath("u1", "abc", "MP4");
    expect(p).toBe("u1/abc.mp4");
    expect(isOwnPath("u1", p)).toBe(true);
    expect(isOwnPath("u2", p)).toBe(false);
    expect(isOwnPath("u1", "u1/../u2/x.mp4")).toBe(false);
  });
  it("maps mime to kind", () => {
    expect(kindForMime("image/png")).toBe("image");
    expect(kindForMime("video/mp4")).toBe("video");
    expect(kindForMime("application/pdf")).toBe("file");
  });
});

describe("display helpers", () => {
  it("linkifies urls without trailing punctuation", () => {
    expect(linkify("Join: https://meet.jit.si/abc. See you")).toEqual([
      { text: "Join: " },
      { text: "https://meet.jit.si/abc", href: "https://meet.jit.si/abc" },
      { text: ". See you" },
    ]);
  });
  it("labels days in the viewer's timezone", () => {
    expect(dayLabel("2026-10-27T15:00:00Z", "America/Denver", now)).toBe("Today");
    expect(dayLabel("2026-10-26T15:00:00Z", "America/Denver", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-20T15:00:00Z", "America/Denver", now)).toBe("Tue, Oct 20");
    expect(dayLabel("2025-10-20T15:00:00Z", "America/Denver", now)).toBe("Mon, Oct 20, 2025");
  });
  it("formats clocks and markers", () => {
    expect(formatClock(75.4)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(markerPercent(5, 20)).toBe(25);
    expect(markerPercent(30, 20)).toBe(100);
    expect(markerPercent(5, 0)).toBe(0);
  });
  it("previews messages", () => {
    expect(messagePreview({ body: null, kind: "image" })).toBe("Sent a photo");
    expect(messagePreview({ body: "hi", kind: "text", deleted: true })).toBe("Message deleted");
  });
});

describe("live sessions", () => {
  it("finds the program day", () => {
    expect(programDayFor("2026-10-20", "2026-10-27", 4)).toEqual({ week: 2, day: 1 });
    expect(programDayFor("2026-10-20", "2026-10-19", 4)).toBeNull();
    expect(programDayFor("2026-10-20", "2026-12-27", 4)).toBeNull();
  });
  it("describes the session clock", () => {
    expect(sessionClock(minsAgo(-5), minsAgo(-65), now).phase).toBe("before");
    expect(sessionClock(minsAgo(10), minsAgo(-50), now).label).toBe("10:00 elapsed · 50:00 left");
    expect(sessionClock(minsAgo(70), minsAgo(10), now).phase).toBe("after");
  });
  it("only embeds known providers", () => {
    expect(isEmbeddableRoom("https://meet.jit.si/HypebySummer-1")).toBe(true);
    expect(isEmbeddableRoom("https://hbs.daily.co/room")).toBe(true);
    expect(isEmbeddableRoom("https://evil.example.com/meet.jit.si")).toBe(false);
    expect(isEmbeddableRoom("javascript:alert(1)")).toBe(false);
  });
});
