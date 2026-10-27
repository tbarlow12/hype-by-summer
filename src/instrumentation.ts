import { checkEnv, formatEnvReport } from "@/lib/env-check";

// Runs once when the server starts: print exactly which settings are missing
// instead of leaving it to the first page to fail with a bare 500.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const problems = checkEnv(process.env);
  if (!problems.length) return;
  const report = formatEnvReport(problems);
  if (problems.some((p) => p.level === "error")) console.error(`\n[config] ${report}\n`);
  else console.warn(`\n[config] ${report}\n`);
}
