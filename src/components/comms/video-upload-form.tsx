"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { uploadFile } from "@/lib/comms/upload-client";
import { createVideoSubmission } from "@/lib/comms/video-actions";
import { UPLOAD_LIMITS, VIDEO_BUCKET, formatClock, validateUpload } from "@/lib/comms/policy";

export function VideoUploadForm({ exercises }: { exercises: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | undefined>();
  const [exerciseId, setExerciseId] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setError(null);
    setDuration(undefined);
    if (!f) return setFile(null);
    const check = validateUpload(VIDEO_BUCKET, { size: f.size, contentType: f.type || "video/mp4" });
    if (!check.ok) {
      setError(check.error);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
    // Read the duration locally so the coach sees it and the timeline can scale.
    const url = URL.createObjectURL(f);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration)) setDuration(Math.round(probe.duration * 10) / 10);
      URL.revokeObjectURL(url);
    };
    probe.onerror = () => URL.revokeObjectURL(url);
    probe.src = url;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a video to upload.");
    const finalTitle = title.trim() || exercises.find((x) => x.id === exerciseId)?.name || "";
    if (!finalTitle) return setError("Give your video a title or pick the exercise.");
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    const up = await uploadFile(VIDEO_BUCKET, file, setProgress, abort.current.signal);
    if (!up.ok) {
      setProgress(null);
      return setError(up.error);
    }
    const res = await createVideoSubmission({
      path: up.path,
      mime: file.type || "video/mp4",
      title: finalTitle,
      note: note.trim() || undefined,
      exerciseId: exerciseId || undefined,
      durationSeconds: duration,
    });
    if (!res.ok) {
      setProgress(null);
      return setError(res.error);
    }
    router.push(`/me/videos/${res.id}`);
  }

  const busy = progress !== null;
  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <Alert tone="red">{error}</Alert> : null}
      <Field
        label="Video"
        htmlFor="video-file"
        hint={`Any video up to ${UPLOAD_LIMITS[VIDEO_BUCKET] / 1024 / 1024} MB. Film from the side at hip height when you can.`}
      >
        <input
          ref={fileRef}
          id="video-file"
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-full file:border-0 file:bg-brand/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand hover:file:bg-brand/20 dark:text-zinc-400"
        />
        {file ? (
          <p className="text-xs text-zinc-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB{duration ? ` · ${formatClock(duration)}` : ""}
          </p>
        ) : null}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Exercise" htmlFor="video-exercise">
          <Select id="video-exercise" value={exerciseId} disabled={busy} onChange={(e) => setExerciseId(e.target.value)}>
            <option value="">Not listed / other</option>
            {exercises.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" htmlFor="video-title" hint="Defaults to the exercise name.">
          <Input id="video-title" value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Back squat, top set 185 lb" />
        </Field>
      </div>
      <Field label="Note for your coach" htmlFor="video-note">
        <Textarea id="video-note" value={note} maxLength={2000} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder="What felt off? Anything you want them to look at?" />
      </Field>
      {busy ? (
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{progress! < 1 ? "Uploading…" : "Saving…"}</span>
            <span>{Math.round(progress! * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress! * 100)}>
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(progress! * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !file}>
          {busy ? "Uploading…" : "Send to coach"}
        </Button>
        {busy && progress! < 1 ? (
          <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
