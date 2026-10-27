"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { VideoEmbed } from "@/components/training/video-embed";
import type { ActionState } from "@/lib/actions";
import { EQUIPMENT, EXERCISE_CATEGORIES, MUSCLES } from "@/lib/training/constants";
import { parseVideoUrl } from "@/lib/training/video";
import { titleCase } from "@/lib/format";

type ExerciseValues = {
  name: string;
  category: string | null;
  primary_muscles: string[];
  equipment: string[];
  instructions: string | null;
  coaching_cues: string[];
  demo_video_url: string | null;
  is_unilateral: boolean;
};

function ChipGroup({ name, options, selected, legend }: { name: string; options: readonly string[]; selected: string[]; legend: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o} className="cursor-pointer">
            <input type="checkbox" name={name} value={o} defaultChecked={selected.includes(o)} className="peer sr-only" />
            <span
              className={cn(
                "inline-flex rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                "border-zinc-300 text-zinc-600 peer-checked:border-brand peer-checked:bg-brand/10 peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 dark:border-zinc-700 dark:text-zinc-400",
              )}
            >
              {titleCase(o)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ExerciseForm({
  action,
  initial,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: ExerciseValues;
  submitLabel: string;
}) {
  const [videoUrl, setVideoUrl] = useState(initial?.demo_video_url ?? "");
  const extraMuscles = (initial?.primary_muscles ?? []).filter((m) => !(MUSCLES as readonly string[]).includes(m));
  const extraEquipment = (initial?.equipment ?? []).filter((m) => !(EQUIPMENT as readonly string[]).includes(m));
  const videoValid = !videoUrl || parseVideoUrl(videoUrl) !== null;

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={initial?.name} required maxLength={120} />
        </Field>
        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={initial?.category ?? ""}>
            <option value="">None</option>
            {EXERCISE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ChipGroup name="primary_muscles[]" legend="Primary muscles" options={MUSCLES} selected={initial?.primary_muscles ?? []} />
      <Field label="Other muscles" htmlFor="muscles_other" hint="Comma separated">
        <Input id="muscles_other" name="muscles_other" defaultValue={extraMuscles.join(", ")} />
      </Field>

      <ChipGroup name="equipment[]" legend="Equipment" options={EQUIPMENT} selected={initial?.equipment ?? []} />
      <Field label="Other equipment" htmlFor="equipment_other" hint="Comma separated">
        <Input id="equipment_other" name="equipment_other" defaultValue={extraEquipment.join(", ")} />
      </Field>

      <Field label="Instructions" htmlFor="instructions">
        <Textarea id="instructions" name="instructions" defaultValue={initial?.instructions ?? ""} rows={4} maxLength={4000} />
      </Field>
      <Field label="Coaching cues" htmlFor="coaching_cues" hint="One cue per line">
        <Textarea id="coaching_cues" name="coaching_cues" defaultValue={(initial?.coaching_cues ?? []).join("\n")} rows={4} />
      </Field>

      <Field
        label="Demo video URL"
        htmlFor="demo_video_url"
        hint={videoValid ? "YouTube, Vimeo or a direct .mp4 link" : "That link isn't a YouTube, Vimeo or .mp4 video"}
      >
        <Input
          id="demo_video_url"
          name="demo_video_url"
          type="url"
          inputMode="url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          aria-invalid={!videoValid}
          placeholder="https://www.youtube.com/watch?v=…"
        />
      </Field>
      {videoUrl && videoValid ? <VideoEmbed url={videoUrl} title="Demo video preview" className="max-w-xl" /> : null}

      <Checkbox name="is_unilateral" defaultChecked={initial?.is_unilateral} label="Unilateral (one side at a time)" />

      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
