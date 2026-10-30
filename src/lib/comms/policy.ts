// Pure helpers for chat, uploads and form-check videos (shared by server and browser).
import { formatInTimeZone } from "date-fns-tz";

export const CHAT_BUCKET = "chat-media" as const;
export const VIDEO_BUCKET = "form-videos" as const;
export type CommsBucket = typeof CHAT_BUCKET | typeof VIDEO_BUCKET;

export const UPLOAD_LIMITS: Record<CommsBucket, number> = {
  [CHAT_BUCKET]: 100 * 1024 * 1024, // 100 MB (bucket limit)
  [VIDEO_BUCKET]: 500 * 1024 * 1024, // 500 MB (bucket limit)
};

/** Minutes a recipient must have been away from the thread before we email them. */
export const EMAIL_AFTER_UNREAD_MINUTES = 10;
/** If they never come back, nudge again at most once a day. */
export const EMAIL_REPEAT_HOURS = 24;

/**
 * Should a new chat message trigger an email to the recipient? Only when they
 * haven't looked at the thread for a while, and only once per unread streak.
 */
export function shouldEmailRecipient(opts: {
  lastReadAt: string | null;
  lastEmailedAt: string | null;
  now?: Date;
}): boolean {
  const now = (opts.now ?? new Date()).getTime();
  const lastRead = opts.lastReadAt ? new Date(opts.lastReadAt).getTime() : null;
  const lastEmailed = opts.lastEmailedAt ? new Date(opts.lastEmailedAt).getTime() : null;
  if (lastRead !== null && now - lastRead < EMAIL_AFTER_UNREAD_MINUTES * 60_000) return false;
  if (lastEmailed === null) return true;
  if (lastRead !== null && lastEmailed < lastRead) return true; // they caught up since the last email
  return now - lastEmailed >= EMAIL_REPEAT_HOURS * 3_600_000;
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
};

/** Safe lowercase file extension from the file name, falling back to the MIME type. */
export function fileExtension(fileName: string, contentType: string): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return MIME_EXT[contentType.toLowerCase()] ?? "bin";
}

export type UploadCheck = { ok: true } | { ok: false; error: string };

export function validateUpload(bucket: CommsBucket, file: { size: number; contentType: string }): UploadCheck {
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  const limit = UPLOAD_LIMITS[bucket];
  if (file.size > limit) return { ok: false, error: `Files must be under ${Math.round(limit / 1024 / 1024)} MB.` };
  if (bucket === VIDEO_BUCKET && !file.contentType.toLowerCase().startsWith("video/")) {
    return { ok: false, error: "Please choose a video file." };
  }
  return { ok: true };
}

/** Storage path for a new upload: `<uploader_id>/<uuid>.<ext>`. */
export function uploadPath(uploaderId: string, id: string, ext: string): string {
  return `${uploaderId}/${id}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`;
}

/** True when the path sits in the uploader's own folder (no traversal tricks). */
export function isOwnPath(uploaderId: string, path: string): boolean {
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === uploaderId && /^[\w-]+\.[a-z0-9]{1,8}$/i.test(parts[1] ?? "");
}

/** Message kind for an attachment's MIME type. */
export function kindForMime(mime: string | null | undefined): "image" | "video" | "file" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return "file";
}

/** Split text into plain and link segments (http/https URLs only). */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: match[0], href: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** "Today" / "Yesterday" / "Mon, Oct 27" (adds the year when it differs). */
export function dayLabel(iso: string, timeZone: string, now = new Date()): string {
  const key = formatInTimeZone(iso, timeZone, "yyyy-MM-dd");
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const yesterday = formatInTimeZone(new Date(now.getTime() - 86_400_000), timeZone, "yyyy-MM-dd");
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return formatInTimeZone(iso, timeZone, sameYear ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

export function dayKey(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, "yyyy-MM-dd");
}

/** 75.4 -> "1:15", 3725 -> "1:02:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Marker position (0-100%) on a timeline bar. */
export function markerPercent(seconds: number, duration: number): number {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (seconds / duration) * 100));
}

/**
 * Team inbox filter: threads with messages, optionally only clients whose
 * primary coach is `mineFor`, matching a name/email search.
 */
export function filterInbox<
  T extends { primary_coach_id: string | null; last_message_at: string | null; client_name: string | null; client_email: string | null },
>(rows: T[], opts: { mineFor?: string | null; q?: string }): T[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  return rows.filter(
    (r) =>
      Boolean(r.last_message_at) &&
      (!opts.mineFor || r.primary_coach_id === opts.mineFor) &&
      (!q || `${r.client_name ?? ""} ${r.client_email ?? ""}`.toLowerCase().includes(q)),
  );
}

/** Which side of a shared team thread wrote a message. */
export function messageSide(senderId: string | null, clientId: string): "system" | "client" | "team" {
  if (!senderId) return "system";
  return senderId === clientId ? "client" : "team";
}

/** Short preview for inbox rows. */
export function messagePreview(m: { body: string | null; kind: string; deleted?: boolean }): string {
  if (m.deleted) return "Message deleted";
  const body = m.body?.trim();
  switch (m.kind) {
    case "image":
      return body || "Sent a photo";
    case "video":
      return body || "Sent a video";
    case "file":
      return body || "Sent a file";
    case "workout_share":
      return "Shared a workout";
    default:
      return body || "";
  }
}

/** Day index (1-based week/day) of a program on a given date, or null if outside it. */
export function programDayFor(startDate: string, onDate: string, durationWeeks: number): { week: number; day: number } | null {
  const start = Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10));
  const on = Date.UTC(+onDate.slice(0, 4), +onDate.slice(5, 7) - 1, +onDate.slice(8, 10));
  const diff = Math.round((on - start) / 86_400_000);
  if (diff < 0) return null;
  const week = Math.floor(diff / 7) + 1;
  if (week > durationWeeks) return null;
  return { week, day: (diff % 7) + 1 };
}

/** Elapsed / countdown label for a live session. */
export function sessionClock(startsAt: string, endsAt: string, now = new Date()): { phase: "before" | "live" | "after"; label: string } {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const t = now.getTime();
  if (t < start) return { phase: "before", label: `Starts in ${formatClock((start - t) / 1000)}` };
  if (t <= end) return { phase: "live", label: `${formatClock((t - start) / 1000)} elapsed · ${formatClock((end - t) / 1000)} left` };
  return { phase: "after", label: `Ended ${formatClock((t - end) / 1000)} ago` };
}

/** Video-room URLs we are willing to embed in an iframe. */
export function isEmbeddableRoom(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "meet.jit.si" || u.hostname.endsWith(".daily.co") || u.hostname.endsWith(".jitsi.net"));
  } catch {
    return false;
  }
}
