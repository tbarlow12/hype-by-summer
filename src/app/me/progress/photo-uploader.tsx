"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Label, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { recordProgressPhoto } from "./actions";

const MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

/** Uploads straight to the private progress-photos bucket under <client_id>/, then records the row. */
export function PhotoUploader({ clientId, today }: { clientId: string; today: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [takenOn, setTakenOn] = useState(today);
  const [pose, setPose] = useState<"front" | "side" | "back" | "other">("front");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload() {
    const files = Array.from(fileRef.current?.files ?? []);
    setError(null);
    setDone(null);
    if (!files.length) return setError("Choose a photo first.");
    for (const f of files) {
      if (!EXT[f.type]) return setError(`${f.name}: use a JPG, PNG, WebP or HEIC photo.`);
      if (f.size > MAX_BYTES) return setError(`${f.name} is over 20 MB.`);
    }
    startTransition(async () => {
      const supabase = createClient();
      for (const f of files) {
        const path = `${clientId}/${takenOn}-${pose}-${crypto.randomUUID()}.${EXT[f.type]}`;
        const { error: upErr } = await supabase.storage.from("progress-photos").upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) return setError(upErr.message);
        const res = await recordProgressPhoto({ storage_path: path, taken_on: takenOn, pose });
        if (!res.ok) {
          await supabase.storage.from("progress-photos").remove([path]);
          return setError(res.error);
        }
      }
      if (fileRef.current) fileRef.current.value = "";
      setDone(files.length === 1 ? "Photo uploaded." : `${files.length} photos uploaded.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <Label htmlFor="photo-file">Photo</Label>
          <input
            ref={fileRef}
            id="photo-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand dark:text-zinc-400"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photo-date">Taken on</Label>
          <Input id="photo-date" type="date" max={today} value={takenOn} onChange={(e) => setTakenOn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="photo-pose">Pose</Label>
          <Select id="photo-pose" value={pose} onChange={(e) => setPose(e.target.value as typeof pose)}>
            <option value="front">Front</option>
            <option value="side">Side</option>
            <option value="back">Back</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="button" onClick={upload} disabled={pending} className="w-full">
            {pending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-500">Private: only you and your coach can see these.</p>
      {error ? <Alert tone="red">{error}</Alert> : null}
      {done ? <Alert tone="green">{done}</Alert> : null}
    </div>
  );
}
