import { z } from "zod";

/** Shape every form server action returns (used with useActionState). */
export type ActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Optional payload, e.g. a created id or redirect URL. */
  data?: Record<string, unknown>;
};

export const ok = (message?: string, data?: Record<string, unknown>): ActionState => ({ ok: true, message, data });
export const fail = (error: string): ActionState => ({ ok: false, error });

/** Parse FormData with a zod schema; returns either data or an ActionState error. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  formData: FormData,
): { data: z.infer<T>; error?: undefined } | { data?: undefined; error: ActionState } {
  const raw: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const all = formData.getAll(key);
    raw[key] = key.endsWith("[]") ? all : all[0];
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    return { error: fail(field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid input")) };
  }
  return { data: result.data };
}

/** Form helpers: empty strings -> undefined, checkboxes -> boolean. */
export const zfd = {
  text: () => z.string().trim().transform((v) => (v === "" ? undefined : v)).optional(),
  requiredText: (msg = "Required") => z.string().trim().min(1, msg),
  int: () => z.coerce.number().int(),
  optionalInt: () =>
    z.union([z.literal(""), z.coerce.number().int()]).optional().transform((v) => (v === "" || v === undefined ? undefined : v)),
  // .optional() (not z.undefined() in the union): zod 4 only treats a missing key as valid when the schema is optional.
  checkbox: () =>
    z
      .union([z.literal("on"), z.literal("true"), z.literal("false")])
      .optional()
      .transform((v) => v === "on" || v === "true"),
  /** Dollars string ("49.99") -> integer cents. */
  cents: () => z.coerce.number().min(0).transform((v) => Math.round(v * 100)),
};
