"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { previewAudience, sendBroadcast, type AudiencePreview } from "./actions";

type Channel = "in_app" | "email" | "sms";

export function BroadcastComposer({ audiences }: { audiences: { value: string; label: string }[] }) {
  const router = useRouter();
  const [audience, setAudience] = useState(audiences[0]?.value ?? "active_clients");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["in_app", "email"]);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, startSend] = useTransition();
  const isLeads = audience === "leads";

  useEffect(() => {
    let active = true;
    setPreviewing(true);
    void previewAudience(audience).then((res) => {
      if (!active) return;
      setPreviewing(false);
      setPreview(res.ok ? res.preview : null);
    });
    return () => {
      active = false;
    };
  }, [audience]);

  const effective: Channel[] = isLeads ? channels.filter((c) => c === "email") : channels;
  const toggle = (c: Channel, on: boolean) => setChannels((prev) => (on ? [...new Set([...prev, c])] : prev.filter((x) => x !== c)));
  const smsText = (smsBody.trim() || `${subject.trim()}: ${body.trim()}`).slice(0, 300);

  function submit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!effective.length) return setResult({ ok: false, text: isLeads ? "Leads can only be reached by email." : "Pick at least one channel." });
    const n = preview?.total ?? 0;
    if (!window.confirm(`Send "${subject}" to ${n} ${n === 1 ? "person" : "people"}? This can't be undone.`)) return;
    startSend(async () => {
      const res = await sendBroadcast({ audience, subject, body, smsBody: smsBody.trim() || undefined, channels: effective });
      if (res.ok) {
        setResult({ ok: true, text: res.message });
        setSubject("");
        setBody("");
        setSmsBody("");
        setShowPreview(false);
        router.refresh();
      } else setResult({ ok: false, text: res.error });
    });
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        {result ? <Alert tone={result.ok ? "green" : "red"}>{result.text}</Alert> : null}
        <Field label="Audience" htmlFor="bc-audience">
          <Select id="bc-audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
            {audiences.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950" aria-live="polite">
          {previewing || !preview ? (
            <span className="text-zinc-500">Counting recipients…</span>
          ) : (
            <>
              <span className="font-semibold">{preview.total}</span> recipient{preview.total === 1 ? "" : "s"}
              <span className="text-zinc-500">
                {" "}
                · {preview.email} by email
                {!isLeads ? ` · ${preview.inApp} in app · ${preview.sms} by SMS (opted in with a phone)` : ""}
              </span>
            </>
          )}
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Channels</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox label="In-app notification" checked={!isLeads && channels.includes("in_app")} disabled={isLeads} onChange={(e) => toggle("in_app", e.target.checked)} />
            <Checkbox label="Email" checked={channels.includes("email")} onChange={(e) => toggle("email", e.target.checked)} />
            <Checkbox label="SMS" checked={!isLeads && channels.includes("sms")} disabled={isLeads} onChange={(e) => toggle("sms", e.target.checked)} />
          </div>
          {isLeads ? (
            <p className="text-xs text-zinc-500">Leads aren&apos;t app users and never get texts, so they&apos;re reached by email only. Each email includes an unsubscribe link.</p>
          ) : null}
          {!isLeads && channels.includes("sms") && preview && !preview.smsConfigured ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">SMS isn&apos;t configured yet (Twilio env vars), so texts will only be logged.</p>
          ) : null}
        </fieldset>

        <Field label="Subject" htmlFor="bc-subject">
          <Input id="bc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} required placeholder="e.g. Holiday schedule + new bootcamp times" />
        </Field>
        <Field label="Message" htmlFor="bc-body" hint="Plain text. Blank lines start a new paragraph.">
          <Textarea id="bc-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} required className="min-h-40" />
        </Field>
        {!isLeads && channels.includes("sms") ? (
          <Field
            label="SMS text (optional)"
            htmlFor="bc-sms"
            hint={`${smsText.length}/300 characters. Leave blank to use the subject and the start of your message. The brand name and STOP opt-out text are added automatically.`}
          >
            <Textarea id="bc-sms" value={smsBody} onChange={(e) => setSmsBody(e.target.value)} maxLength={300} className="min-h-20" />
          </Field>
        ) : null}

        {showPreview && (subject || body) ? (
          <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Email preview</p>
            <p className="mt-2 text-lg font-bold">{subject || "(no subject)"}</p>
            {body
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, i) => (
                <p key={i} className="mt-2 text-sm whitespace-pre-wrap">
                  {p.trim()}
                </p>
              ))}
            {!isLeads && channels.includes("sms") ? (
              <>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">SMS preview</p>
                <p className="mt-1 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">{smsText}</p>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={sending || !subject.trim() || !body.trim() || !preview?.total}>
            {sending ? "Sending…" : `Send to ${preview?.total ?? 0}`}
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowPreview((s) => !s)} className={cn(!subject && !body && "hidden")}>
            {showPreview ? "Hide preview" : "Preview"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
