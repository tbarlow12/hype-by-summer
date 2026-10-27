"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";

type Notification = Pick<Tables<"notifications">, "id" | "type" | "title" | "body" | "link" | "read_at" | "created_at">;

const LIMIT = 20;

/** Bell with unread count, dropdown list, mark-all-read and realtime inserts. */
export function NotificationsBell() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (uid: string) => {
      const [{ data }, { count }] = await Promise.all([
        supabase
          .from("notifications")
          .select("id, type, title, body, link, read_at, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).is("read_at", null),
      ]);
      setItems(data ?? []);
      setUnread(count ?? 0);
      setLoaded(true);
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;
    void supabase.auth.getClaims().then(({ data }) => {
      const uid = data?.claims?.sub;
      if (active && uid) {
        setUserId(uid);
        void load(uid);
      }
    });
    return () => {
      active = false;
    };
  }, [supabase, load]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, LIMIT)));
          if (!n.read_at) setUnread((u) => u + 1);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    await supabase.from("notifications").update({ read_at: now }).eq("user_id", userId).is("read_at", null);
  }

  async function openItem(n: Notification) {
    setOpen(false);
    if (!n.read_at) {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void supabase.from("notifications").update({ read_at: now }).eq("id", n.id);
    }
    if (n.link?.startsWith("/")) router.push(n.link);
  }

  if (!userId) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-brand dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread ? (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-[18px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl lg:right-auto lg:left-0 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="text-sm font-semibold">Notifications</p>
            {unread ? (
              <button type="button" onClick={markAllRead} className="text-xs font-semibold text-brand hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          {!loaded ? (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">You&apos;re all caught up. New activity will show up here.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                      !n.read_at && "bg-brand/5",
                    )}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.read_at && "font-semibold")}>{n.title}</span>
                      {n.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500">{n.body}</span> : null}
                      <span className="mt-1 block text-[11px] text-zinc-400">
                        {formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
