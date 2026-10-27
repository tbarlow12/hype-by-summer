"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Alert, Avatar, Button, buttonClass, cn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";
import { CHAT_BUCKET, dayKey, dayLabel, kindForMime, linkify, UPLOAD_LIMITS } from "@/lib/comms/policy";
import { MESSAGE_COLUMNS, type ChatMessage, type Person } from "@/lib/comms/types";
import { deleteChatMessage, editChatMessage, sendChatMessage, shareWorkout, startVideoCall } from "@/lib/comms/chat-actions";
import { uploadFile } from "@/lib/comms/upload-client";

type LocalMessage = ChatMessage & {
  status?: "sending" | "failed";
  error?: string;
  progress?: number;
  localUrl?: string;
};

type Pending = { text: string; file: File | null; workoutLogId?: string };

const PAGE_SIZE = 50;

export function ChatThread({
  conversationId,
  viewerId,
  viewerIsTrainer,
  timezone,
  other,
  clientId,
  initialMessages,
  initialUrls,
  initialOtherLastReadAt,
  initialHasMore,
  initialUnread,
  workouts = [],
  backHref,
}: {
  conversationId: string;
  viewerId: string;
  viewerIsTrainer: boolean;
  timezone: string;
  other: Person & { subtitle?: string };
  clientId: string;
  initialMessages: ChatMessage[];
  initialUrls: Record<string, string>;
  initialOtherLastReadAt: string | null;
  initialHasMore: boolean;
  initialUnread: number;
  /** Client only: recent workout logs that can be shared into the thread. */
  workouts?: { id: string; label: string }[];
  backHref?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(initialOtherLastReadAt);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<{ tone: "red" | "green"; text: ReactNode } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [calling, setCalling] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prependFrom = useRef<number | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const signing = useRef(new Set<string>(Object.keys(initialUrls)));
  const fileInput = useRef<HTMLInputElement>(null);
  const localUrls = useRef(new Map<string, string>());

  const upsert = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === incoming.id);
      if (i === -1) return [...prev, incoming].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const next = prev.slice();
      next[i] = { ...prev[i], ...incoming, status: undefined, error: undefined, progress: undefined };
      return next;
    });
  }, []);

  const patch = useCallback((id: string, p: Partial<LocalMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));
  }, []);

  // --- read receipts -------------------------------------------------------
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markRead = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (markTimer.current) return;
    markTimer.current = setTimeout(() => {
      markTimer.current = null;
      void supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
    }, 800);
  }, [supabase, conversationId]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("mark_conversation_read", { p_conversation: conversationId }).then(() => {
      // Refresh once so the nav unread badge drops.
      if (!cancelled && initialUnread > 0) router.refresh();
    });
    const onVisible = () => markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (markTimer.current) clearTimeout(markTimer.current);
    };
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // --- realtime ---------------------------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as ChatMessage;
          upsert(m);
          if (m.sender_id !== viewerId) markRead();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => upsert(payload.new as ChatMessage),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const c = payload.new as Tables<"conversations">;
          setOtherReadAt(viewerIsTrainer ? c.client_last_read_at : c.trainer_last_read_at);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, viewerId, viewerIsTrainer, upsert, markRead]);

  // --- attachment URLs for messages that arrived later ---------------------------
  useEffect(() => {
    const missing = messages
      .map((m) => m.attachment_path)
      .filter((p): p is string => Boolean(p) && !signing.current.has(p!));
    if (!missing.length) return;
    for (const p of missing) signing.current.add(p);
    void supabase.storage
      .from(CHAT_BUCKET)
      .createSignedUrls(missing, 60 * 60)
      .then(({ data }) => {
        const add: Record<string, string> = {};
        for (const row of data ?? []) if (row.path && row.signedUrl) add[row.path] = row.signedUrl;
        setUrls((u) => ({ ...u, ...add }));
      });
  }, [messages, supabase]);

  // --- scrolling ------------------------------------------------------------------
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const last = messages[messages.length - 1];
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current;
      prependFrom.current = null;
      return;
    }
    if (stick.current || last?.sender_id === viewerId) el.scrollTop = el.scrollHeight;
  }, [messages.length, last?.id, last?.sender_id, viewerId]);

  async function loadEarlier() {
    const oldest = messages.find((m) => !m.status);
    if (!oldest) return;
    setLoadingMore(true);
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    setLoadingMore(false);
    if (error) {
      setNotice({ tone: "red", text: "Couldn't load earlier messages." });
      return;
    }
    const older = (data ?? []).reverse();
    setHasMore(older.length === PAGE_SIZE);
    prependFrom.current = scroller.current?.scrollHeight ?? null;
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      return [...older.filter((m) => !ids.has(m.id)), ...prev];
    });
  }

  // --- sending ---------------------------------------------------------------------
  async function deliver(id: string, job: Pending) {
    pending.current.set(id, job);
    patch(id, { status: "sending", error: undefined });
    let result;
    if (job.workoutLogId) {
      result = await shareWorkout({ id, conversationId, workoutLogId: job.workoutLogId });
    } else {
      let attachmentPath: string | undefined;
      let attachmentMime: string | undefined;
      if (job.file) {
        const up = await uploadFile(CHAT_BUCKET, job.file, (p) => patch(id, { progress: p }));
        if (!up.ok) {
          patch(id, { status: "failed", error: up.error });
          return;
        }
        attachmentPath = up.path;
        attachmentMime = up.mime;
        // Drop the file from the retry job so a retry doesn't upload twice.
        job = { ...job, file: null };
        pending.current.set(id, job);
      }
      result = await sendChatMessage({ id, conversationId, body: job.text || undefined, attachmentPath, attachmentMime }).catch(
        () => ({ ok: false as const, error: "Message not sent. Check your connection." }),
      );
      if (!result.ok && attachmentPath) {
        // Keep the uploaded file for the retry.
        pending.current.set(id, { ...job, file: null });
        patch(id, { attachment_path: attachmentPath, attachment_mime: attachmentMime ?? null });
      }
    }
    if (result.ok) {
      pending.current.delete(id);
      const localUrl = localUrls.current.get(id);
      if (result.message.attachment_path && localUrl) {
        signing.current.add(result.message.attachment_path);
        setUrls((u) => ({ ...u, [result.message.attachment_path!]: localUrl }));
      }
      upsert(result.message);
    } else {
      patch(id, { status: "failed", error: result.error });
    }
  }

  function send() {
    const text = draft.trim();
    if (!text && !file) return;
    const id = crypto.randomUUID();
    const optimistic: LocalMessage = {
      id,
      conversation_id: conversationId,
      sender_id: viewerId,
      kind: file ? kindForMime(file.type) : "text",
      body: text || null,
      attachment_path: null,
      attachment_mime: file?.type || null,
      workout_log_id: null,
      video_submission_id: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      status: "sending",
      progress: file ? 0 : undefined,
      localUrl: file ? URL.createObjectURL(file) : undefined,
    };
    if (optimistic.localUrl) localUrls.current.set(id, optimistic.localUrl);
    stick.current = true;
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    void deliver(id, { text, file });
  }

  async function retry(m: LocalMessage) {
    const job = pending.current.get(m.id);
    if (!job) return;
    if (m.attachment_path) {
      patch(m.id, { status: "sending" });
      const res = await sendChatMessage({
        id: m.id,
        conversationId,
        body: job.text || undefined,
        attachmentPath: m.attachment_path,
        attachmentMime: m.attachment_mime ?? undefined,
      });
      if (res.ok) {
        pending.current.delete(m.id);
        upsert(res.message);
      } else patch(m.id, { status: "failed", error: res.error });
      return;
    }
    void deliver(m.id, job);
  }

  function shareLog(workoutLogId: string, label: string) {
    setShareOpen(false);
    const id = crypto.randomUUID();
    stick.current = true;
    setMessages((prev) => [
      ...prev,
      {
        id,
        conversation_id: conversationId,
        sender_id: viewerId,
        kind: "workout_share",
        body: label,
        attachment_path: null,
        attachment_mime: null,
        workout_log_id: workoutLogId,
        video_submission_id: null,
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        status: "sending",
      },
    ]);
    void deliver(id, { text: "", file: null, workoutLogId });
  }

  async function saveEdit() {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
    const prev = messages.find((m) => m.id === editing.id);
    patch(editing.id, { body, edited_at: new Date().toISOString() });
    setEditing(null);
    const res = await editChatMessage({ id: editing.id, body });
    if (res.ok) upsert(res.message);
    else {
      if (prev) patch(prev.id, { body: prev.body, edited_at: prev.edited_at });
      setNotice({ tone: "red", text: res.error });
    }
  }

  async function remove(m: LocalMessage) {
    setMenuFor(null);
    if (!window.confirm("Delete this message for everyone?")) return;
    patch(m.id, { deleted_at: new Date().toISOString() });
    const res = await deleteChatMessage({ id: m.id });
    if (res.ok) upsert(res.message);
    else {
      patch(m.id, { deleted_at: null });
      setNotice({ tone: "red", text: res.error });
    }
  }

  async function call() {
    setCalling(true);
    const res = await startVideoCall({ clientId });
    setCalling(false);
    if (res.ok) {
      setNotice({
        tone: "green",
        text: (
          <>
            Call link posted in the thread.{" "}
            <a href={res.url} target="_blank" rel="noreferrer" className="font-semibold underline">
              Join now
            </a>
          </>
        ),
      });
    } else setNotice({ tone: "red", text: res.error });
  }

  function onPickFile(f: File | null) {
    if (f && f.size > UPLOAD_LIMITS[CHAT_BUCKET]) {
      setNotice({ tone: "red", text: "Attachments must be under 100 MB. For long form-check videos use Form checks." });
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(f);
  }

  // The last message I sent that the other person has seen / not seen.
  const lastMine = [...messages].reverse().find((m) => m.sender_id === viewerId && m.kind !== "system" && !m.status);
  const seen = Boolean(lastMine && otherReadAt && otherReadAt >= lastMine.created_at);

  let prevDay = "";
  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[440px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:h-[calc(100dvh-8rem)] dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {backHref ? (
          <a href={backHref} className="-ml-1 rounded-full p-1 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800" aria-label="Back to conversations">
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M12.7 4.3a1 1 0 010 1.4L8.4 10l4.3 4.3a1 1 0 01-1.4 1.4l-5-5a1 1 0 010-1.4l5-5a1 1 0 011.4 0z" clipRule="evenodd" />
            </svg>
          </a>
        ) : null}
        <Avatar name={other.name} src={other.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{other.name}</p>
          {other.subtitle ? <p className="truncate text-xs text-zinc-500">{other.subtitle}</p> : null}
        </div>
        {viewerIsTrainer ? (
          <Button variant="outline" size="sm" onClick={call} disabled={calling} aria-label={`Start a video call with ${other.name}`}>
            <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M3 5a2 2 0 012-2h7a2 2 0 012 2v1.6l2.4-1.5A1 1 0 0118 6v8a1 1 0 01-1.6.9L14 13.4V15a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
            </svg>
            {calling ? "Starting…" : "Video call"}
          </Button>
        ) : null}
      </div>

      {notice ? (
        <div className="flex items-start gap-2 px-4 pt-3">
          <div className="flex-1">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
          <button onClick={() => setNotice(null)} className="mt-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}

      {/* Messages */}
      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-5" role="log" aria-live="polite" aria-label={`Conversation with ${other.name}`}>
        {hasMore ? (
          <div className="pb-2 text-center">
            <Button variant="ghost" size="sm" onClick={loadEarlier} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-zinc-500">
            <Avatar name={other.name} src={other.avatarUrl} size={56} />
            <p className="mt-3 font-semibold text-zinc-900 dark:text-zinc-100">Start the conversation</p>
            <p className="mt-1 max-w-xs">
              {viewerIsTrainer
                ? `Say hi to ${other.name.split(" ")[0]}: check in on training, share tips or answer questions.`
                : "Ask your coach anything: training questions, schedule changes, how a session felt."}
            </p>
          </div>
        ) : null}
        {messages.map((m) => {
          const day = dayKey(m.created_at, timezone);
          const separator =
            day !== prevDay ? (
              <div className="flex items-center gap-3 py-3 text-xs font-medium text-zinc-500" role="separator">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                {dayLabel(m.created_at, timezone)}
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
            ) : null;
          prevDay = day;
          return (
            <Fragment key={m.id}>
              {separator}
              {m.kind === "system" ? (
                <SystemMessage m={m} timezone={timezone} />
              ) : (
                <Bubble
                  m={m}
                  mine={m.sender_id === viewerId}
                  timezone={timezone}
                  url={m.attachment_path ? (urls[m.attachment_path] ?? m.localUrl) : m.localUrl}
                  receipt={m.id === lastMine?.id ? (seen ? "Seen" : "Sent") : null}
                  editing={editing?.id === m.id ? editing.body : null}
                  onEditChange={(body) => setEditing({ id: m.id, body })}
                  onEditSave={saveEdit}
                  onEditCancel={() => setEditing(null)}
                  menuOpen={menuFor === m.id}
                  onMenu={() => setMenuFor(menuFor === m.id ? null : m.id)}
                  onEdit={() => {
                    setMenuFor(null);
                    setEditing({ id: m.id, body: m.body ?? "" });
                  }}
                  onDelete={() => remove(m)}
                  onRetry={() => retry(m)}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Composer */}
      <form
        className="border-t border-zinc-200 p-3 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {file ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
            <span className="truncate">📎 {file.name}</span>
            <span className="shrink-0 text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
            <button type="button" className="ml-auto text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onPickFile(null)}>
              Remove
            </button>
          </div>
        ) : null}
        {shareOpen ? (
          <div className="mb-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Share a workout</p>
            {workouts.length ? (
              <ul className="max-h-48 overflow-y-auto">
                {workouts.map((w) => (
                  <li key={w.id}>
                    <button type="button" onClick={() => shareLog(w.id, w.label)} className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      {w.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-1 text-sm text-zinc-500">No logged workouts yet. Log one from My plan, then share it here.</p>
            )}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            id={`attach-${conversationId}`}
            accept="image/*,video/*,application/pdf,.doc,.docx,.txt,.csv"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          <label
            htmlFor={`attach-${conversationId}`}
            className={buttonClass("ghost", "md", "size-10 shrink-0 cursor-pointer px-0")}
            title="Attach a photo, video or file"
          >
            <span className="sr-only">Attach a file</span>
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M15.5 9.5l-5.8 5.8a3.5 3.5 0 01-5-5l6.2-6.2a2.3 2.3 0 013.3 3.3l-6.1 6.1a1.2 1.2 0 01-1.7-1.7l5.6-5.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </label>
          {!viewerIsTrainer ? (
            <Button type="button" variant="ghost" className="size-10 shrink-0 px-0" onClick={() => setShareOpen((o) => !o)} aria-expanded={shareOpen} title="Share a workout">
              <span className="sr-only">Share a workout</span>
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M3 8v4M6 6v8M14 6v8M17 8v4M6 10h8" strokeLinecap="round" />
              </svg>
            </Button>
          ) : null}
          <label htmlFor={`draft-${conversationId}`} className="sr-only">
            Message
          </label>
          <textarea
            id={`draft-${conversationId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={`Message ${other.name.split(" ")[0]}…`}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            style={{ fieldSizing: "content" } as CSSProperties}
          />
          <Button type="submit" className="h-10 shrink-0" disabled={!draft.trim() && !file}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("break-words whitespace-pre-wrap", className)}>
      {linkify(text).map((seg, i) =>
        seg.href ? (
          <a key={i} href={seg.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {seg.text}
          </a>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </p>
  );
}

function SystemMessage({ m, timezone }: { m: ChatMessage; timezone: string }) {
  const join = linkify(m.body ?? "").find((s) => s.href && /meet\.jit\.si|daily\.co/.test(s.href));
  return (
    <div className="flex justify-center py-1.5">
      <div className="max-w-[90%] rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-2 text-center text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
        <RichText text={m.body ?? ""} />
        {join?.href ? (
          <a href={join.href} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm", "mt-2")}>
            Join call
          </a>
        ) : null}
        <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">{formatInTimeZone(m.created_at, timezone, "h:mm a")}</p>
      </div>
    </div>
  );
}

function Bubble({
  m,
  mine,
  timezone,
  url,
  receipt,
  editing,
  onEditChange,
  onEditSave,
  onEditCancel,
  menuOpen,
  onMenu,
  onEdit,
  onDelete,
  onRetry,
}: {
  m: LocalMessage;
  mine: boolean;
  timezone: string;
  url?: string;
  receipt: string | null;
  editing: string | null;
  onEditChange: (body: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const deleted = Boolean(m.deleted_at);
  const canManage = mine && !deleted && !m.status;
  const canEdit = canManage && m.kind !== "workout_share";
  const bubble = cn(
    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]",
    mine ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
    deleted && "bg-transparent! text-zinc-400! italic ring-1 ring-zinc-200 dark:ring-zinc-700",
    m.status === "failed" && "opacity-70",
  );

  return (
    <div className={cn("group flex flex-col py-0.5", mine ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-full items-center gap-1", mine ? "flex-row-reverse" : "flex-row")}>
        <div className={bubble}>
          {deleted ? (
            <p>Message deleted</p>
          ) : editing !== null ? (
            <div className="flex w-64 max-w-full flex-col gap-2">
              <label htmlFor={`edit-${m.id}`} className="sr-only">
                Edit message
              </label>
              <textarea
                id={`edit-${m.id}`}
                value={editing}
                autoFocus
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onEditSave();
                  }
                  if (e.key === "Escape") onEditCancel();
                }}
                className="min-h-16 rounded-lg bg-white/95 px-2 py-1 text-sm text-zinc-900"
              />
              <div className="flex justify-end gap-2 text-xs font-semibold">
                <button type="button" onClick={onEditCancel}>
                  Cancel
                </button>
                <button type="button" onClick={onEditSave} className="rounded-full bg-white/20 px-2 py-0.5">
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <Attachment m={m} url={url} />
              {m.kind === "workout_share" ? (
                <div className="flex flex-col gap-1">
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", mine ? "text-white/80" : "text-brand")}>🏋️ Workout shared</p>
                  {m.body ? <RichText text={m.body} /> : null}
                </div>
              ) : m.body ? (
                <RichText text={m.body} className={m.attachment_path || m.localUrl ? "mt-1.5" : undefined} />
              ) : null}
              {m.status === "sending" && m.progress !== undefined && m.progress < 1 ? (
                <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/30" role="progressbar" aria-valuenow={Math.round(m.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                  <div className="h-full bg-white transition-all" style={{ width: `${Math.round(m.progress * 100)}%` }} />
                </div>
              ) : null}
            </>
          )}
        </div>
        {canManage && editing === null ? (
          <div className="relative">
            <button
              type="button"
              onClick={onMenu}
              className="rounded-full px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-zinc-800"
              aria-label="Message options"
              aria-expanded={menuOpen}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 bottom-full z-10 mb-1 w-28 overflow-hidden rounded-xl border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {canEdit ? (
                  <button type="button" onClick={onEdit} className="block w-full px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    Edit
                  </button>
                ) : null}
                <button type="button" onClick={onDelete} className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950">
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="mt-0.5 px-1 text-[11px] text-zinc-400">
        {formatInTimeZone(m.created_at, timezone, "h:mm a")}
        {m.edited_at && !deleted ? " · edited" : ""}
        {m.status === "sending" ? " · Sending…" : ""}
        {receipt ? ` · ${receipt}` : ""}
      </p>
      {m.status === "failed" ? (
        <p className="px-1 text-xs text-red-600">
          {m.error ?? "Not sent."}{" "}
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Retry
          </button>
        </p>
      ) : null}
    </div>
  );
}

function Attachment({ m, url }: { m: LocalMessage; url?: string }) {
  const kind = m.kind === "image" || m.kind === "video" || m.kind === "file" ? m.kind : null;
  if (!kind || (!m.attachment_path && !m.localUrl)) return null;
  if (!url) return <div className="h-32 w-48 animate-pulse rounded-xl bg-black/10" aria-label="Loading attachment" />;
  if (kind === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="-mx-1.5 -mt-0.5 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={m.body ? `Photo: ${m.body}` : "Shared photo"} className="max-h-72 rounded-xl object-cover" loading="lazy" />
      </a>
    );
  }
  if (kind === "video") {
    return <video src={url} controls preload="metadata" playsInline className="-mx-1.5 -mt-0.5 max-h-80 rounded-xl bg-black" />;
  }
  const ext = (m.attachment_path ?? "").split(".").pop()?.toUpperCase() ?? "FILE";
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-medium underline underline-offset-2">
      <span aria-hidden="true">📄</span> Download {ext} attachment
    </a>
  );
}
