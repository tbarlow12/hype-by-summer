// iCalendar (RFC 5545) generation for booking attachments and the trainer's
// subscription feed. Pure; all times are written in UTC.

export type IcsEvent = {
  uid: string;
  start: string | Date;
  end: string | Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Bumped on every change so calendar apps apply updates. */
  sequence?: number;
  organizer?: { name?: string; email: string };
  attendees?: { name?: string; email: string }[];
  created?: string | Date;
  lastModified?: string | Date;
  /** Minutes before the start for a display alarm. */
  alarmMinutes?: number;
};

export type IcsCalendar = {
  events: IcsEvent[];
  method?: "PUBLISH" | "REQUEST" | "CANCEL";
  name?: string;
  prodId?: string;
  /** Suggested refresh interval for subscription feeds, in minutes. */
  refreshMinutes?: number;
};

export function icsDate(value: string | Date): string {
  const iso = new Date(value).toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line to 75 octets per RFC 5545 §3.1 (continuations start with a space). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74; // continuation lines carry a leading space
    }
    current += char;
    currentBytes += bytes;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

function contact(prop: string, c: { name?: string; email: string }, extra = ""): string {
  const name = c.name ? `;CN="${c.name.replace(/"/g, "'")}"` : "";
  return `${prop}${name}${extra}:mailto:${c.email}`;
}

export function buildIcs(calendar: IcsCalendar): string {
  const now = icsDate(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${calendar.prodId ?? "-//HYPE by Summer//Booking//EN"}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${calendar.method ?? "PUBLISH"}`,
  ];
  if (calendar.name) {
    lines.push(`X-WR-CALNAME:${escapeText(calendar.name)}`, `NAME:${escapeText(calendar.name)}`);
  }
  if (calendar.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${calendar.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${calendar.refreshMinutes}M`);
  }
  for (const e of calendar.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `SEQUENCE:${e.sequence ?? 0}`,
      `STATUS:${e.status ?? "CONFIRMED"}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.created) lines.push(`CREATED:${icsDate(e.created)}`);
    if (e.lastModified) lines.push(`LAST-MODIFIED:${icsDate(e.lastModified)}`);
    if (e.organizer) lines.push(contact("ORGANIZER", e.organizer));
    for (const a of e.attendees ?? []) lines.push(contact("ATTENDEE", a, ";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED"));
    if (e.alarmMinutes && e.status !== "CANCELLED") {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(e.summary)}`,
        `TRIGGER:-PT${e.alarmMinutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" template link. */
export function googleCalendarUrl(e: Pick<IcsEvent, "start" | "end" | "summary" | "description" | "location">): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.summary,
    dates: `${icsDate(e.start)}/${icsDate(e.end)}`,
  });
  if (e.description) params.set("details", e.description);
  if (e.location) params.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
