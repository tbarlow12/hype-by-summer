// What the platform does, grouped for the landing and features pages.
// Every feature is on every plan.

export type FeatureGroup = { id: string; icon: string; title: string; summary: string; points: string[] };

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "booking",
    icon: "📅",
    title: "Booking",
    summary: "A booking page that fills your calendar, with no double-bookings and no back-and-forth.",
    points: [
      "1:1, small-group and class sessions; in person, virtual, phone or at the client's place",
      "Weekly hours per coach, time off, buffers, minimum notice and booking horizon",
      "Shows times in each client's timezone and handles daylight saving",
      "Free consult flow for new leads, waitlists for full classes",
      "Cancellation window with late-cancel and no-show fees",
      "Email and text reminders; clients reschedule or cancel from a link",
      "Calendar feed for Google or Apple Calendar",
    ],
  },
  {
    id: "payments",
    icon: "💳",
    title: "Payments",
    summary: "Sell sessions, packs and memberships. Money goes straight to your own Stripe account.",
    points: [
      "Pay per session, session packs with expiry, monthly memberships with credits",
      "One-off products and digital downloads",
      "Promo codes, refunds, custom invoices and optional sales tax",
      "Clients manage cards, receipts and memberships themselves",
      "Revenue, MRR and outstanding credits at a glance",
    ],
  },
  {
    id: "programming",
    icon: "🏋️",
    title: "Programming",
    summary: "Build programs once, assign them in seconds, and see every set your clients log.",
    points: [
      "Exercise library with demo videos and coaching cues, plus your own movements",
      "Week-by-day program builder with sets, reps, load, rest, tempo and supersets",
      "Templates, copy weeks, assign with a start date",
      "Workout logging prefilled from last time, with effort, pain and notes for you",
      "Weekly check-ins, body metrics, progress photos, habits and goals",
    ],
  },
  {
    id: "app",
    icon: "📱",
    title: "Client app",
    summary: "An installable app with your logo on the home screen. Bookings, plan, progress and billing.",
    points: [
      "Today's workout, upcoming sessions and credits on one screen",
      "Installs to the phone like a native app (no app store needed)",
      "Intake questionnaire and e-signed waiver at onboarding",
      "Personal records, streaks and progress over time",
    ],
  },
  {
    id: "chat",
    icon: "💬",
    title: "Chat & form checks",
    summary: "Message clients in real time and review their lift videos with comments pinned to the moment.",
    points: [
      "Real-time chat with photos, videos and files, shared by your whole team",
      "Form-check videos with timestamped coach comments",
      "Live video sessions in the app",
      "Broadcasts to clients, members or leads by app, email or text",
    ],
  },
  {
    id: "leads",
    icon: "🧲",
    title: "Lead funnels",
    summary: "Turn followers into clients with a free-guide giveaway, a consult and a simple CRM.",
    points: [
      "Free-guide landing pages with qualifying questions and instant delivery",
      "Lead pipeline with source tracking (UTM, referrer), scoring, notes and follow-ups",
      "One-click invite turns a lead into a client",
      "Testimonials collected from clients and shown on your site",
    ],
  },
  {
    id: "brand",
    icon: "🎨",
    title: "Your brand + domain",
    summary: "Your name, logo, colors and domain everywhere. Your clients never see ours.",
    points: [
      "Free subdomain to start, connect your own domain anytime (SSL included)",
      "Logo, brand color and type style on the site, app, emails and texts",
      "Emails and texts come from your business name",
      "Your own marketing homepage with services, bio, FAQ and contact form",
    ],
  },
  {
    id: "team",
    icon: "👥",
    title: "Team",
    summary: "Grow from solo to studio: each coach gets their own calendar, clients and pay reporting.",
    points: [
      "Owner, admin, coach and staff roles",
      "Per-coach availability and booking pages; clients pick a coach or anyone",
      "Shared inbox and client notes; revenue by coach",
    ],
  },
];
