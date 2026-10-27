# Hype by Summer

Personal-training business platform: Next.js 16 App Router + Supabase + Stripe, TypeScript only.
Read `AGENTS.md` (Next 16 differs from older versions: `proxy.ts` not middleware, async request APIs;
docs in `node_modules/next/dist/docs/`). Cache Components is off; routes render per request.

- Domain logic lives in `src/lib/<area>/` (scheduling, payments, training, comms, leads, clients);
  pure functions there have vitest tests next to them. Pages/actions stay thin.
- Data rules live in SQL: `supabase/migrations/` (RLS on every table, RPCs for booking/credits/leads).
  New schema = new migration + SQL test in `supabase/tests/`, then regenerate
  `src/lib/supabase/database.types.ts`.
- `createClient()` (RLS, as the user) by default; `createAdminClient()` only in trusted server code,
  scoped by ids you've authorized. Authorize every server action (`requireTrainer` / `requireClient`).
- Forms: server actions returning `ActionState` + `parseForm`/`zfd` (`src/lib/actions.ts`), UI from
  `src/components/ui.tsx` and `form.tsx`.
- Times are stored UTC; display in the coach's or viewer's `profiles.timezone`.
- Before committing: `npm run typecheck && npm run lint && npm test && npm run db:test && npm run build`.
