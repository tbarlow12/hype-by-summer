"use client";

import { useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Uploads an image straight to the public-media bucket under
 * `<userId>/<prefix>-<timestamp>.<ext>` and puts the public URL into a hidden
 * input named `name`, so the surrounding server-action form just saves a URL.
 */
export function ImageUpload({
  userId,
  name,
  prefix,
  defaultUrl,
  label,
  shape = "circle",
}: {
  userId: string;
  name: string;
  prefix: string;
  defaultUrl?: string | null;
  label: string;
  shape?: "circle" | "wide";
}) {
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError("Use a JPG, PNG, WebP or GIF image.");
    if (file.size > MAX_BYTES) return setError("Images must be 8 MB or smaller.");
    setBusy(true);
    const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${userId}/${prefix}-${Date.now()}.${ext}`;
    const supabase = createClient();
    const { error: upErr } = await supabase.storage.from("public-media").upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    setBusy(false);
    if (upErr) return setError(upErr.message);
    setUrl(supabase.storage.from("public-media").getPublicUrl(path).data.publicUrl);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className={shape === "circle" ? "size-16 rounded-full object-cover" : "h-20 w-40 rounded-xl object-cover"}
          />
        ) : (
          <span
            className={
              (shape === "circle" ? "size-16 rounded-full" : "h-20 w-40 rounded-xl") +
              " flex items-center justify-center bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800"
            }
          >
            None
          </span>
        )}
        <input
          ref={input}
          id={id}
          type="file"
          accept={TYPES.join(",")}
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : url ? "Replace" : "Upload"}
        </Button>
        {url ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setUrl("")}>
            Remove
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
      <input type="hidden" name={name} value={url} />
    </div>
  );
}
