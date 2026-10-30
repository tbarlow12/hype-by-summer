# White-label training platform

Multi-business (white-label) platform for personal trainers and studios: Next.js 16 App Router +
Supabase + Stripe Connect, TypeScript only. Read `AGENTS.md` (Next 16 differs from older versions:
`proxy.ts` not middleware, async request APIs; docs in `node_modules/next/dist/docs/`). Cache Components
is off; routes render per request. Architecture and env vars: `README.md`.

## Tenancy (read before touching any business data)
- The request host picks the business (`lib/platform.ts` classifies, `lib/tenant.ts` resolves):
  `getBusiness()` / `requireBusiness()`. The platform's own site (business = null) lives in
  `src/app/platform/**` (proxy rewrites `/`, `/pricing`, `/features`, `/start`, `/admin`, `/legal`).
- Never trust a business id from the client, URL or form. Derive it from `requireBusiness()` /
  `requireStaff()` / `requireClient()`; for webhooks and cron (no host) look the business up by the row's id.
- Not a marketplace: a business's pages, emails, SMS and ICS show only that business. Never list, link or
  name other businesses or the platform there. All features are on for every business (no plan gating).
- Every business-owned row has `business_id`; coach-specific rows also `coach_id`. Every query on the
  service-role client must `.eq("business_id", business.id)` (anon has no table access, so public pages use
  `createAdminClient()` scoped this way).
- Roles are per business: `requireStaff(roles?)` → `{ profile, business, membership }`,
  `requireManager()` (owner/admin) for money/settings/team, `isManager(m)` in UI, `requireClient()`,
  `requirePlatformAdmin()` for `/admin`. Coach views default to "mine" with an "everyone" toggle where it
  matters; managers see all.
- URLs: in-app links stay relative (the host decides the business). Absolute links (emails, SMS, ICS,
  Stripe redirects) use `brand.siteUrl` / `businessUrl(business, path)`; platform links `platformUrl()`.
- Branding: `brandOf(business)` / `brandForBusiness(id)` → `Brand`. `sendEmail({ brand, ... })` and
  `sendSms({ brand, ... })` require it. Brand-filled UI uses `bg-brand text-on-brand`, brand text `text-brand`.
- Auth emails are ours, not Supabase's: `lib/auth-emails.ts` (`sendMagicLink`, `sendSignupConfirmation`,
  `sendPasswordReset`, `sendInvite`) → `/auth/confirm`. Never call `signInWithOtp`, `signUp`,
  `inviteUserByEmail` or `resetPasswordForEmail` (they send Supabase-branded mail). Don't reveal whether an
  email has an account.
- Money: charges run on the business's connected Stripe account; Starter adds an application fee
  (`businesses.platform_fee_bps`), Pro none.

## Conventions
- Domain logic lives in `src/lib/<area>/` (scheduling, payments, training, comms, leads, clients);
  pure functions there have vitest tests next to them. Pages/actions stay thin.
- Data rules live in SQL: `supabase/migrations/` (RLS on every table, RPCs for booking/credits/leads).
  New schema = new migration + SQL test in `supabase/tests/` (cover cross-business isolation), then
  regenerate `src/lib/supabase/database.types.ts` (`DATABASE_URL=... npm run db:types`).
- `createClient()` (RLS, as the user) by default; `createAdminClient()` only in trusted server code, scoped
  by business + ids you've authorized. Authorize and zod-validate every server action; never trust
  client-sent prices or amounts.
- Forms: server actions returning `ActionState` + `parseForm`/`zfd` (`src/lib/actions.ts`), UI from
  `src/components/ui.tsx` and `form.tsx`. The platform site has its own look (`src/app/platform/_components`,
  `platform.css`); don't use it on business pages.
- Times are stored UTC; display in the business's, coach's or viewer's timezone.
- New env vars: add to `.env.example`, `README.md` and `src/lib/env-check.ts` (+ its test).
- Before committing: `npm run typecheck && npm run lint && npm test && npm run db:test && npm run build`.
