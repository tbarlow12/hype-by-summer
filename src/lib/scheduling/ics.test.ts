import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, googleCalendarUrl, icsDate } from "./ics";

const event = {
  uid: "b-1@hypebysummer",
  start: "2026-10-28T15:00:00.000Z",
  end: "2026-10-28T16:00:00.000Z",
  summary: "1:1 Training, with Summer",
  description: "Bring water; wear shoes.\nSee you there!",
  location: "Studio 5, Denver",
};

describe("ics", () => {
  it("formats UTC dates", () => {
    expect(icsDate("2026-10-28T15:00:00.000Z")).toBe("20261028T150000Z");
    expect(icsDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("20260102T030405Z");
  });

  it("escapes text values", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 octets", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    expect(parts[0]!.length).toBe(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(" ")).toBe(true);
      expect(p.length).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("never splits a multi-byte character", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const p of folded.split("\r\n")) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });

  it("builds a valid calendar with CRLF line endings", () => {
    const ics = buildIcs({
      method: "PUBLISH",
      events: [{ ...event, organizer: { name: "Summer", email: "s@example.com" }, attendees: [{ email: "c@example.com" }], alarmMinutes: 60 }],
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:b-1@hypebysummer");
    expect(ics).toContain("DTSTART:20261028T150000Z");
    expect(ics).toContain("DTEND:20261028T160000Z");
    expect(ics).toContain("SUMMARY:1:1 Training\\, with Summer");
    expect(ics).toContain("DESCRIPTION:Bring water\\; wear shoes.\\nSee you there!");
    expect(ics).toContain("LOCATION:Studio 5\\, Denver");
    expect(ics).toContain('ORGANIZER;CN="Summer":mailto:s@example.com');
    expect(ics).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:c@example.com");
    expect(ics).toContain("TRIGGER:-PT60M");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("marks cancellations and skips alarms for them", () => {
    const ics = buildIcs({ method: "CANCEL", events: [{ ...event, status: "CANCELLED", sequence: 2, alarmMinutes: 30 }] });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).not.toContain("VALARM");
  });

  it("supports feeds with many events and a name", () => {
    const ics = buildIcs({ name: "Coach sessions", refreshMinutes: 30, events: [event, { ...event, uid: "b-2" }] });
    expect(ics).toContain("X-WR-CALNAME:Coach sessions");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT30M");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("builds a Google Calendar link", () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261028T150000Z/20261028T160000Z");
    expect(url.searchParams.get("text")).toBe(event.summary);
    expect(url.searchParams.get("location")).toBe(event.location);
  });
});
