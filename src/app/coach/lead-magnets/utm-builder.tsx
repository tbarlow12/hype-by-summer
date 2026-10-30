"use client";

import { useId, useMemo, useState } from "react";
import { Button, Field, Input, cn } from "@/components/ui";
import { buildUtmUrl, UTM_PRESETS } from "@/lib/leads/utm";

export function CopyButton({ text, label = "Copy link", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt("Copy this link", text);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      <span aria-live="polite">{copied ? "Copied!" : label}</span>
    </Button>
  );
}

/** Builds a trackable share link (utm_source / medium / campaign / content). */
export function UtmBuilder({ baseUrl, defaultCampaign }: { baseUrl: string; defaultCampaign?: string }) {
  const id = useId();
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState(defaultCampaign ?? "");
  const [content, setContent] = useState("");
  const url = useMemo(() => buildUtmUrl(baseUrl, { source, medium, campaign, content }), [baseUrl, source, medium, campaign, content]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {UTM_PRESETS.map((p) => {
          const active = p.source === source && p.medium === medium;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setSource(p.source);
                setMedium(p.medium);
              }}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                active ? "border-brand bg-brand/10 text-brand" : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Source" htmlFor={`${id}-s`}>
          <Input id={`${id}-s`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="instagram" />
        </Field>
        <Field label="Medium" htmlFor={`${id}-m`}>
          <Input id={`${id}-m`} value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="social" />
        </Field>
        <Field label="Campaign" htmlFor={`${id}-c`}>
          <Input id={`${id}-c`} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="new-year-2027" />
        </Field>
        <Field label="Content (optional)" htmlFor={`${id}-ct`}>
          <Input id={`${id}-ct`} value={content} onChange={(e) => setContent(e.target.value)} placeholder="bio-link" />
        </Field>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-xl bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800" title={url}>
          {url}
        </code>
        <CopyButton text={url} label="Copy tracking link" />
      </div>
    </div>
  );
}
