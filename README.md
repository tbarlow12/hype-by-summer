# White-label training platform

Software for personal trainers and studios, sold as a white-label platform. Each business gets its own
branded site and client app at `<slug>.<platform domain>` (or its own domain) with Calendly-style
booking, Stripe payments (sessions, packs, memberships, products), programming and workout logging,
check-ins and progress, chat and form-check videos, live video sessions, SMS/email reminders, and lead
funnels. The platform's own site (marketing, trainer signup, admin) runs on the platform domain.

The product name is a placeholder: set `NEXT_PUBLIC_PLATFORM_NAME` (default "TrainerOS").

**It is not a marketplace.** A business's site only ever shows that business: no other businesses, no
platform branding, no links between them. Every feature is enabled for every business; the plan only
changes how the platform is paid (see [Plans](#plans)).

**Stack:** TypeScript, Next.js 16 (App Router, server actions, `proxy.ts`), Supabase (Postgres, Auth,
Storage, Realtime), Stripe + Stripe Connect, Resend (email), Twilio (SMS), Tailwind CSS v4.
See [FEATURES.md](FEATURES.md) for what's built and the roadmap.

## Architecture

### Hosts → tenant
`src/proxy.ts` → `lib/supabase/proxy.ts` classifies every request by host (`lib/platform.ts`):

| Host | Serves |
| --- | --- |
| `<PLATFORM_DOMAIN>`, `www.`, `app.` | The platform's own site. `/`, `/pricing`, `/features`, `/start`, `/admin`, `/legal` are rewritten to `src/app/platform/**`; business-only paths (`/book`, `/me`, …) redirect home. |
| `<slug>.<PLATFORM_DOMAIN>` | That business's site (`businesses.slug`). |
| any other host | A business's verified custom domain (`businesses.custom_domain` + `domain_verified_at`). |

Server code gets the current business from `lib/tenant.ts`: `getBusiness()` / `requireBusiness()` (404 for
unknown, unverified or suspended businesses). Roles are per business (`lib/auth.ts`): staff are
`business_members` (owner, admin, coach, staff), clients are `business_clients`; signing in on a business's
site and visiting `/me` makes you its client. Platform admins are `profiles.is_platform_admin`, granted
automatically to the emails in `PLATFORM_ADMIN_EMAILS`.

In production the Supabase session cookie is set on `.<PLATFORM_DOMAIN>`, so one sign-in covers the
platform and every subdomain. Custom domains have their own cookie (people sign in there once).

### Data
Every business-owned row has `business_id`; coach-specific rows also have `coach_id`. RLS is on for every
table: anon has no table access, staff see their business (`is_member`), managers write settings/money
(`can_manage`), clients see their own rows. Public pages (marketing site, booking, giveaways) read with the
service-role client **scoped by the business resolved from the host**. Bookings, credits and leads go
through RPCs (`reserve_booking` takes a per-coach lock and checks overlaps + capacity, so double-booking is
prevented inside Postgres).

### Money
Each business connects its own Stripe account (Stripe Connect). Client charges are created on that
account; on the Starter plan the platform takes an application fee (`businesses.platform_fee_bps`,
recorded in `platform_fees`), on Pro it takes none and bills a monthly subscription on the platform's own
Stripe account.

### Auth emails
We send every auth email ourselves, branded as the business (`lib/auth-emails.ts`): `sendMagicLink`,
`sendSignupConfirmation`, `sendPasswordReset`, `sendInvite`. They call `auth.admin.generateLink()` for a
hashed token and email a link to `<site>/auth/confirm?token_hash=…&type=magiclink|signup|invite|recovery&next=…`,
which verifies it on that host (so the cookie lands on the right site). Signup never reveals whether an
email already has an account: existing accounts get a sign-in link and the same "check your email"
message. Recovery links land on `/reset-password`. **Supabase's own email templates are never used, so
they can stay at their defaults.**

### Where things live
```
src/app/platform/       platform site: landing, /features, /pricing, /start (trainer signup), /admin, /legal
src/app/(auth)/         login, signup, forgot/reset password (branded per host)
src/app/auth/           confirm (email links), callback (OAuth/PKCE), continue (post-login router), signout
src/app/(marketing)/    a business's public site: homepage, /pricing, /free/[slug] giveaway funnel
src/app/book, booking/  public booking + guest "manage my booking"
src/app/coach/          staff portal (calendar, clients, leads, programs, payments, team, settings, ...)
src/app/me/             client portal (book, plan, log workouts, messages, check-ins, billing, ...)
src/app/api/            stripe/webhook, twilio/{inbound,status}, cron/reminders, calendar feed, ...
src/lib/                tenant.ts, auth.ts, platform.ts, auth-emails.ts, email.ts, sms.ts, notify.ts
src/lib/<area>/         domain logic per area (scheduling, payments, training, comms, leads, clients)
supabase/migrations/    schema, RLS, RPCs (source of truth for data rules)
supabase/tests/         SQL behaviour tests (tenancy isolation, booking conflicts, credits, ...)
```

## Local development

Requires Node 22+ and Docker (or any Postgres 16+ for the SQL tests).

```bash
npm install
npx supabase start            # local Postgres/Auth/Storage/Realtime; applies migrations + seed
cp .env.example .env.local    # paste the URL + keys `supabase start` printed
npm run seed:demo             # optional demo business (see the script header for its slug + logins)
npm run dev
```

- Platform site: http://localhost:3000 (landing, `/pricing`, `/start`, `/admin`).
- A business: http://`<slug>`.localhost:3000. Browsers resolve `*.localhost` to your machine, no hosts file
  needed. Keep `NEXT_PUBLIC_PLATFORM_DOMAIN=localhost:3000`.
- Create a business at http://localhost:3000/start. Cookies aren't shared between `localhost` and
  `<slug>.localhost`, so after creating it you sign in once more on the new subdomain (the page tells you).
- Put your email in `PLATFORM_ADMIN_EMAILS` to open `/admin`.
- Without Stripe/Resend/Twilio keys the app still runs: emails (sign-in links included) and texts are
  printed to the server console; card payments show a friendly error.
- To test a single business on a host you don't control (e.g. a Vercel preview URL), set
  `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`.

## Checks

```bash
npm run typecheck     # next typegen + tsc
npm run lint
npm test              # vitest (slot engine, DST, payments mapping, host routing, env check, ...)
npm run db:test       # applies every migration to a throwaway Postgres DB and runs supabase/tests
npm run build
```

`db:test` needs a Postgres 16+ server (`DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/postgres`).
After changing the schema, regenerate types: `DATABASE_URL=... npm run db:types` (no Docker needed) or
`npx supabase gen types typescript --local > src/lib/supabase/database.types.ts`.

## Environment variables

See `.env.example` for the full list with comments. On boot the server logs a `[config]` report naming
anything missing or malformed (`src/lib/env-check.ts`, run from `src/instrumentation.ts`).

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | yes | Supabase project. The secret key is server-only. |
| `NEXT_PUBLIC_PLATFORM_DOMAIN` | yes | Root host, e.g. `yourplatform.com` (`localhost:3000` locally). Businesses live at `<slug>.<this>`. |
| `NEXT_PUBLIC_PLATFORM_NAME` | recommended | The platform's brand name (only shown on the platform's own site). |
| `PLATFORM_ADMIN_EMAILS` | recommended | Comma-separated emails that get platform admin (`/admin`). |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | no | Business to serve on hosts that aren't the platform's (previews). |
| `PLATFORM_STARTER_FEE_BPS` | no | Starter plan fee in basis points (default `300` = 3%). Applied to new businesses. |
| `PLATFORM_PRO_PRICE_DOLLARS` | no | Pro plan monthly price shown on the pricing page (default `49`). |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | for payments | The platform's Stripe account (with Connect enabled). |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | Signing secret of the **platform-account** webhook endpoint. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | with Stripe | Signing secret of the **connected-accounts** webhook endpoint. |
| `STRIPE_AUTOMATIC_TAX` | no | `true` once Stripe Tax is set up. |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | for email | Resend key + an address on your verified domain. Each email's display name is the business. |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | for custom domains | Lets businesses add their own domain from Settings (added to the Vercel project via API). Without them the settings page shows manual DNS steps. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` / `TWILIO_MESSAGING_SERVICE_SID` | for SMS | Text reminders; otherwise logged. |
| `CRON_SECRET` | for reminders | Vercel Cron bearer token for `/api/cron/reminders`. |
| `VIDEO_PROVIDER`, `DAILY_API_KEY` | no | `jitsi` (default, demo-grade) or `daily` for live sessions. |
| `LEAD_TOKEN_SECRET` | no | Signs lead download/unsubscribe tokens (falls back to the Supabase secret key). |

`OWNER_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BRAND_NAME` and `NEXT_PUBLIC_PRIMARY_TRAINER_SLUG` are
gone: businesses, their owners and their URLs come from the database and the request host.

## Plans

| | Starter | Pro |
| --- | --- | --- |
| Monthly | $0 | `PLATFORM_PRO_PRICE_DOLLARS` (default $49) |
| Platform fee on client payments | `PLATFORM_STARTER_FEE_BPS` (default 3%) | 0% |
| Features | all | all |

The fee is a Stripe application fee on each charge on the business's connected account; Stripe's own
processing fees apply on both plans.

## Going live

### 1. Domain + Vercel
1. Buy the platform domain. In Vercel, import the repo and add **both** `yourplatform.com` and the
   wildcard `*.yourplatform.com` to the project.
2. DNS: point the wildcard at Vercel (`*.yourplatform.com` CNAME `cname.vercel-dns.com`, apex A
   `76.76.21.21`). Wildcard certificates require the domain's nameservers to be Vercel's
   (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`); Vercel shows this when you add the wildcard.
3. Set `NEXT_PUBLIC_PLATFORM_DOMAIN=yourplatform.com` and the other env vars, deploy.
4. Custom domains: create a Vercel access token and set `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` (and
   `VERCEL_TEAM_ID` for team projects). Businesses then add `theirstudio.com` in Settings; they point a
   CNAME (or the apex A record) at Vercel and the app verifies it.
5. `vercel.json` schedules `/api/cron/reminders` every 15 minutes; set `CRON_SECRET`.

### 2. Supabase
1. Create a project, link and push: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Load the exercise library once: run `supabase/seed.sql` in the SQL editor.
2. **Auth → URL configuration:** Site URL = `https://yourplatform.com`. Redirect URLs: add
   `https://yourplatform.com/**` and `https://*.yourplatform.com/**` (and each business's custom domain as
   `https://theirstudio.com/**` if you use OAuth providers). Our email links verify on `/auth/confirm`
   with `verifyOtp`, which doesn't need an allow-listed redirect, but OAuth/PKCE (`/auth/callback`) does.
3. **Auth → Email templates:** leave them at the defaults. Auth emails are generated with
   `auth.admin.generateLink` and sent by the app through Resend, branded per business, so Supabase never
   sends them. Keep **Confirm email** on (signups must confirm via our link).
4. **Storage:** raise the global upload limit (paid plans) so long form-check videos upload; buckets allow
   up to 500 MB.

### 3. Stripe (platform account + Connect)
1. Enable **Connect** on the platform's Stripe account (Express/Standard per your setup) and fill in the
   platform profile. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test keys first).
2. Create **two** webhook endpoints, both to `https://yourplatform.com/api/stripe/webhook`:
   - *Your account* events → `STRIPE_WEBHOOK_SECRET`: `checkout.session.completed`,
     `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.paid`, `invoice.payment_failed`, `application_fee.created`, `application_fee.refunded`.
   - *Connected accounts* events → `STRIPE_CONNECT_WEBHOOK_SECRET`: `account.updated`,
     `account.application.deauthorized`, `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
     `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`,
     `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
     `charge.refunded`, `payment_intent.payment_failed`.
3. Local testing: `stripe listen --forward-connect-to localhost:3000/api/stripe/webhook --forward-to localhost:3000/api/stripe/webhook`.
4. Each business connects its own account from **Coach → Payments**; packages, memberships and products
   are created in **Coach → Packages & plans** (the app creates the Stripe Products/Prices on their account).

### 4. Email, SMS, video
- **Resend:** verify the platform's sending domain, set `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`
  (e.g. `notifications@yourplatform.com`). Emails show the business's name as the sender and use the
  business's support email as reply-to.
- **Twilio:** buy a number, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (or
  `TWILIO_MESSAGING_SERVICE_SID`). Point incoming messages to `https://yourplatform.com/api/twilio/inbound`
  (POST). US numbers need **A2P 10DLC registration**. Texts go only to people who opted in; STOP/START are
  handled automatically.
- **Video:** `VIDEO_PROVIDER=jitsi` is fine for demos (public rooms cap embedded calls at ~5 minutes); use
  `VIDEO_PROVIDER=daily` + `DAILY_API_KEY` for real sessions.

### 5. Before taking real businesses
- Have a lawyer write the platform terms (`/legal` is a plain-language placeholder) and review the client
  liability waiver (`src/lib/clients/waiver.ts`; bump `WAIVER_VERSION` after edits).
- Add yourself to `PLATFORM_ADMIN_EMAILS`; `/admin` lists businesses, plans, Stripe status, volume and
  fees, and suspends or reactivates a business (its site and app go offline while suspended).
