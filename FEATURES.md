# Features

A white-label platform: every business (a solo trainer or a studio with a team) gets its own branded
site and client app on `<slug>.<platform domain>` or its own domain. Every feature below is available to
every business; the plan (Starter: $0/month + a % of client payments, Pro: flat monthly, 0% fee) only
changes how the platform is paid.

## Built

### Platform
- Platform marketing site (landing, features, pricing with a plan-cost calculator, terms) on the platform
  domain, in the platform's own brand. It never lists or links customer businesses.
- Trainer signup (`/start`): create an account, pick a business name, web address (live availability
  check, reserved words, suggestions), timezone and brand color. Seeds a free consult, a 1:1 session and
  weekday hours, then opens the new dashboard. Existing owners see links to their dashboards.
- Host routing: platform domain, `<slug>.` subdomains, verified custom domains (added via the Vercel API
  from Settings, with DNS instructions and verification), single-tenant mode for previews.
- Multi-business data model with RLS isolation; per-business roles (owner, admin, coach, staff) and clients.
- Stripe Connect: each business's payments go to its own Stripe account; Starter application fees are
  recorded per business; Pro subscriptions billed on the platform account.
- Platform admin (`/admin`): businesses with plan, Stripe Connect status, custom domain, team and client
  counts, money processed, platform fees earned, created date; search, filters, suspend/reactivate.
- Branded auth everywhere: sign-in links, signup confirmation, password reset and invites are sent by the
  app in the business's name and colors (no Supabase-branded mail); signup never reveals existing accounts.

### Booking & scheduling (Calendly-style)
- Public booking page per business (and per coach) listing session types with price, length, location;
  clients pick a coach or "anyone".
- Month calendar + time slots in the visitor's timezone (switchable); DST-safe slot engine.
- Session types: 1:1, group classes with capacity and "spots left", virtual, phone, at-client.
  Per-type buffers, minimum notice, booking horizon, slot interval, colors, members-only types.
- Weekly hours (multiple ranges per day, optionally limited to certain session types), time off, extra hours.
- Double-booking prevented in the database (per-coach lock, overlap + capacity checks).
- Free consult flow for prospects (no payment, captured as a lead with attribution).
- Pay by card (Stripe Checkout with a 30-minute slot hold), session credits, or pay later.
- Guests manage their booking from an emailed link: cancel, reschedule, add to Google Calendar, .ics.
- Cancellation policy: free cancellation window, late-cancel and no-show fees charged to the saved card,
  automatic refunds or returned credits per policy.
- Waitlist for full group classes (emails when a spot opens).
- Coach calendar (week grid + agenda), booking detail (complete / no-show / cancel / notes / reschedule),
  book on behalf of a client, recurring weekly bookings.
- Private calendar feed (subscribe in Google/Apple Calendar).
- Reminders by email and SMS at configurable hours before each session (cron every 15 min).

### Payments (Stripe Connect)
- Session packs (credits with expiry, limited to chosen session types).
- Memberships / subscriptions (monthly etc., trials, credits each billing period).
- One-off products and digital downloads (delivered by expiring link).
- Promo codes, optional Stripe Tax, idempotent webhook processing with retries.
- Coach payments dashboard: revenue this/last month, MRR, active members, outstanding credits,
  12-month chart, refunds (partial), custom invoices for any amount, manual credit grants.
- Client billing page: credits by type with expiry, memberships (cancel/resume), receipts, invoices,
  downloads, Stripe Customer Portal for payment methods.
- Stripe Products/Prices created on the business's connected account and kept in sync with its catalog.

### Lead capture & marketing
- Marketing homepage: hero, free-guide capture, services, how it works, testimonials, coach bio, FAQ, contact form.
- Free-guide giveaway funnel (`/free/<slug>`): landing page, qualifying questions, consent, instant download
  + emailed link, consult upsell. Downloads tracked per lead.
- Rich lead records: goal, experience, preferred format, timeline, budget, location, injuries, how they heard,
  first- and last-touch attribution (UTM, referrer, landing page), consent record, IP/country, lead score.
- Leads CRM: pipeline by status, filters (status, source, guide, campaign, follow-up due), search, CSV export,
  timeline of events, notes, follow-up dates, email a lead, mark lost, invite as client (auto-converts).
- Lead-magnet manager: PDF + cover upload, UTM link builder, stats (leads, downloads, consults, conversions).
- One-click unsubscribe, testimonials (client submission + moderation), SEO metadata, sitemap.

### Coaching & training
- Exercise library (26 seeded movements + the coach's own, with demo videos and coaching cues).
- Program builder: weeks × days grid, exercises with sets/reps/load/rest/tempo/supersets, copy weeks,
  duplicate workouts, templates, assign to clients with a start date.
- Client plan view with dated calendar, today's workout, adherence.
- Workout logging: per-set reps/weight/RPE prefilled from last time; session RPE, difficulty, enjoyment,
  energy, pain flag and notes for the coach; freestyle workouts.
- Feedback loop: coach replies to each workout, end-of-week program feedback, warning flags
  (pain, too hard / too easy trends).
- Weekly check-ins (sleep, stress, energy, adherence, wins, struggles, questions) with coach replies.
- Progress: body metrics charts, progress photos with side-by-side compare, habits with streaks,
  goals with progress bars, personal records and estimated 1RM.

### Communication
- Real-time chat between a client and the business (one thread shared by all staff) with photo/video/file attachments, read receipts, edit/delete,
  workout sharing, and email nudges only when a message goes unread.
- Form-check videos: client uploads, coach leaves comments pinned to timestamps on a timeline.
- Live virtual sessions embedded in the app (Jitsi by default, Daily.co for production), plus ad-hoc video calls from chat.
- In-app notification bell, broadcasts to clients/leads/members by in-app, email and SMS.
- SMS via Twilio with opt-in per person/booking, STOP/START handling, delivery tracking.

### Client accounts & coach tools
- Onboarding checklist, health questionnaire (PAR-Q style), e-signed liability waiver (versioned).
- Client roster with next session, last workout, credits, membership, last message; invite by email.
- Client hub: bookings, credits, payments and lifetime value, training summary, intake, private notes.
- Coach dashboard: today's schedule, KPIs, "needs your attention" inbox, recent activity.
- Team: invite coaches and staff with roles; per-coach availability, calendars and revenue attribution.
- Settings: storefront, branding (logo, color, font preset), custom domain, policies, reminders, calendar feed.
  Installable as a phone app (PWA) with the business's name and icon.

## Roadmap

**Platform**
- Entitlements: per-plan limits or add-ons (e.g. SMS bundles, extra coaches, custom-domain count) behind a
  single `entitlements(business)` check, once pricing needs more than the two plans. Today nothing is gated.
- Platform billing self-serve: plan switching with proration, dunning for Pro, invoices in the dashboard.
- Onboarding checklist for new businesses (connect Stripe, upload logo, set hours, publish).
- Per-business sending domains for email (DKIM on the business's own domain) and per-business SMS numbers.
- Admin: impersonate-to-support (audited), business notes, usage analytics, cohort retention, fee payouts report.
- Data export and import (clients, packages, history) for businesses switching from other tools.
- Templates marketplace between businesses is intentionally out of scope (not a marketplace).

**Growth**
- Referral program (give/get credits), gift cards, intro offers ("first session $29").
- Automated lead nurture email sequences after the free guide; abandoned-booking follow-ups.
- Multiple lead magnets A/B tested; quiz-style funnels ("which program fits you?").
- Review requests after the Nth session; Google Business review links.
- Instagram link-in-bio page; Meta/Google ads conversion tracking (pixel + server events).

**Scheduling**
- Two-way Google Calendar sync (block busy times from coaches' personal calendars).
- Multiple locations / rooms, travel buffers; semi-private (2–3 person) sessions.
- Rescheduling limits, deposits instead of full prepay.

**Coaching**
- Nutrition: macro targets, meal check-ins with photos, MyFitnessPal / Cronometer import.
- Wearables: Apple Health / Google Fit / Garmin / Whoop steps, sleep, HR into progress.
- Voice notes in chat; self-guided programs sold to non-clients.
- Auto-progression rules (e.g. +5 lb when all sets hit top reps); deload weeks.
- Challenges and leaderboards for group members.

**Business**
- Coach payroll/commission payouts, accounting export (QuickBooks/Xero), year-end tax summary.
- Contracts with minimum terms, pause membership, failed-payment dunning sequences.
- Native mobile apps (Expo) per business (white-label builds) with push notifications.
