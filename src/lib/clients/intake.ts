// Health intake: PAR-Q+ style readiness questions plus training background.

export const PARQ_QUESTIONS = [
  { key: "heart_condition", text: "Has a doctor ever said you have a heart condition or high blood pressure?" },
  { key: "chest_pain", text: "Do you feel pain in your chest at rest, during daily activities, or when you exercise?" },
  { key: "dizziness", text: "Do you lose balance because of dizziness, or have you lost consciousness in the last 12 months?" },
  { key: "chronic_condition", text: "Have you been diagnosed with another chronic medical condition (other than heart disease or high blood pressure)?" },
  { key: "medications", text: "Are you currently taking prescribed medications for a chronic medical condition?" },
  { key: "bone_joint", text: "Do you have a bone, joint or soft-tissue problem that could be made worse by becoming more physically active?" },
  { key: "supervised_only", text: "Has a doctor ever said you should only do medically supervised physical activity?" },
  { key: "pregnant", text: "Are you pregnant or have you given birth in the last 12 months?" },
] as const;

export type ParqKey = (typeof PARQ_QUESTIONS)[number]["key"];
export type ParqAnswers = Partial<Record<ParqKey, boolean>>;

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner: new to structured training" },
  { value: "intermediate", label: "Intermediate: training consistently for 6+ months" },
  { value: "advanced", label: "Advanced: years of structured training" },
] as const;

export const PRIMARY_GOALS = [
  { value: "lose_fat", label: "Lose body fat" },
  { value: "build_muscle", label: "Build muscle" },
  { value: "strength", label: "Get stronger" },
  { value: "event_prep", label: "Prepare for an event" },
  { value: "postpartum", label: "Postpartum return to fitness" },
  { value: "general_health", label: "General health & energy" },
] as const;

export function labelFor(list: readonly { value: string; label: string }[], value: string | null | undefined) {
  return list.find((o) => o.value === value)?.label ?? value ?? "";
}

/** Read stored jsonb answers defensively (anything non-boolean is "unanswered"). */
export function readParqAnswers(raw: unknown): ParqAnswers {
  const out: ParqAnswers = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const q of PARQ_QUESTIONS) {
    const v = (raw as Record<string, unknown>)[q.key];
    if (typeof v === "boolean") out[q.key] = v;
  }
  return out;
}

/** Questions answered "yes": any of these means "get medical clearance first". */
export function parqFlags(answers: ParqAnswers): ParqKey[] {
  return PARQ_QUESTIONS.filter((q) => answers[q.key] === true).map((q) => q.key);
}

export function parqComplete(answers: ParqAnswers): boolean {
  return PARQ_QUESTIONS.every((q) => typeof answers[q.key] === "boolean");
}

type IntakeLike = {
  answers: unknown;
  experience_level: string | null;
  primary_goal: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
} | null | undefined;

export function intakeComplete(intake: IntakeLike): boolean {
  if (!intake) return false;
  return (
    parqComplete(readParqAnswers(intake.answers)) &&
    !!intake.experience_level &&
    !!intake.primary_goal &&
    !!intake.emergency_contact_name &&
    !!intake.emergency_contact_phone
  );
}
