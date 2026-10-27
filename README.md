# HYPE by Summer

A complete platform for a personal-training business: Calendly-style booking, Stripe payments
(sessions, packs, memberships, one-off products), client coaching (programs, workout logging,
feedback, check-ins, progress), chat and form-check videos, live virtual sessions, SMS/email
reminders, and a lead-capture marketing site with a free-guide giveaway.

**Stack:** TypeScript, Next.js 16 (App Router, server actions), Supabase (Postgres, Auth, Storage,
Realtime), Stripe, Resend (email), Twilio (SMS), Tailwind CSS v4. See [FEATURES.md](FEATURES.md) for
everything that's built and the roadmap.

## Quick start (local)

Requires Node 22+ and Docker.

```bash
npm install
npx supabase start            # local Postgres/Auth/Storage/Realtime; applies migrations + seed
cp .env.example .env.local    # paste the URL + keys `supabase start` printed
npm run seed:demo             # demo coach + client, sessions, offers, a program, leads
npm run dev
```

Sign in at http://localhost:3000/login:

| Role | Email | Password |
| --- | --- | --- |
| Coach | coach@demo.hypebysummer.com | trainhard123 |
| Client | client@demo.hypebysummer.com | trainhard123 |

Without Stripe/Resend/Twilio keys the app still runs: emails and texts are printed to the server
console, and card payments show a friendly error. In production the **first account to sign up
becomes the coach** (business owner); everyone after is a client.

## Where things live

```
src/app/(marketing)/   public site: homepage, /pricing, /free/[slug] giveaway funnel, /unsubscribe
src/app/book, booking/ public booking pages + guest "manage my booking" page
src/app/coach/         coach portal (dashboard, calendar, clients, leads, programs, payments, ...)
src/app/me/            client portal (book, plan, log workouts, messages, check-ins, billing, ...)
src/app/live/          embedded video room for virtual sessions
src/app/api/           stripe/webhook, twilio/{inbound,status}, cron/reminders, calendar feed, ...
src/lib/<area>/        domain logic per area (scheduling, payments, training, comms, leads, clients)
supabase/migrations/   schema, RLS policies, RPCs (the source of truth for data rules)
supabase/tests/        SQL behaviour tests (booking conflicts, credits, RLS isolation, ...)
```

Money, credits, and booking creation are written only by trusted server code (service role); RLS
lets each user read their own data, and coaches read their clients'. Double-booking is prevented
inside Postgres (`reserve_booking` takes a per-coach lock and checks overlaps + capacity).

## Checks

```bash
npm run typecheck     # next typegen + tsc
npm run lint
npm test              # vitest unit tests (slot engine, DST, payments mapping, scoring, ...)
npm run db:test       # applies every migration to a throwaway Postgres DB and runs supabase/tests
npm run build
```

`db:test` needs a Postgres 16+ server (`DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/postgres`).
CI (`.github/workflows/ci.yml`) runs all of the above.

After changing the schema, regenerate types: `npx supabase gen types typescript --local >
src/lib/supabase/database.types.ts` (or `DATABASE_URL=... npm run db:types`, which needs no Docker).

## Going live

### 1. Supabase
1. Create a project and link it: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Load the exercise library once: run `supabase/seed.sql` in the SQL editor.
2. **Auth → URL configuration:** Site URL = your domain; add `https://<domain>/auth/callback` and
   `https://<domain>/auth/confirm` as redirect URLs.
3. **Auth → Email templates:** point links at `/auth/confirm` so they work from any device:
   - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/me`
   - Magic link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` (users then set a new password under Profile / Settings)
4. **Storage:** the free plan caps uploads at 50 MB. Raise the global limit (paid plans) so long
   form-check videos upload; buckets themselves allow up to 500 MB.
5. Set up custom SMTP (e.g. Resend) under Auth so sign-in emails come from your domain.

### 2. Stripe
1. Use test keys first. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. Add a webhook endpoint `https://<domain>/api/stripe/webhook` with these events, then set
   `STRIPE_WEBHOOK_SECRET`:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `charge.refunded`, `payment_intent.payment_failed`.
3. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. Optional: enable Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`. Customize the Customer Portal
   in the dashboard (the app creates a default configuration if none exists).
5. Packages, memberships and products are created in **Coach → Packages & plans**; the app creates
   the Stripe Products/Prices for you.

### 3. Email, SMS, video
- **Resend:** verify your domain, set `RESEND_API_KEY` and `EMAIL_FROM`.
- **Twilio:** buy a number, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`
  (or `TWILIO_MESSAGING_SERVICE_SID`). Point the number's incoming-message webhook to
  `https://<domain>/api/twilio/inbound` (POST). US numbers need **A2P 10DLC registration** before
  carriers will deliver texts; it takes a few days. Texts go only to people who opted in, and
  STOP/START are handled automatically.
- **Video:** the default (`VIDEO_PROVIDER=jitsi`) uses free public Jitsi rooms, which now limit
  embedded calls to about 5 minutes. For real sessions use Daily.co: `VIDEO_PROVIDER=daily` and
  `DAILY_API_KEY`.

### 4. Deploy (Vercel)
Import the repo, add the env vars from `.env.example`, deploy. `vercel.json` schedules
`/api/cron/reminders` every 15 minutes (reminders, waitlist notices, expiring unpaid holds,
auto-completing past sessions); set `CRON_SECRET` and Vercel sends it automatically.

### 5. Before taking real clients
- Have a lawyer review the liability waiver (`src/lib/clients/waiver.ts`); bump `WAIVER_VERSION`
  after edits and clients are asked to re-sign.
- Upload the giveaway PDF in **Coach → Lead magnets** and replace the demo copy.
- Set cancellation window, late-cancel and no-show fees in **Coach → Settings**.
