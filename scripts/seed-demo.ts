/**
 * Creates demo businesses, accounts and data in a Supabase project so every
 * screen has something to show. Safe to re-run (skips what already exists).
 *
 *   npm run seed:demo        # reads .env.local
 *
 * Businesses:
 *   summer     "HYPE by Summer": two coaches, clients, sessions, offers, a program, leads
 *   ironworks  "Ironworks Strength": a separate business that must never see Summer's data
 *
 * Accounts (password: "trainhard123"):
 *   coach@demo.hypebysummer.com    owner of HYPE by Summer
 *   coach2@demo.hypebysummer.com   coach at HYPE by Summer
 *   client@demo.hypebysummer.com   client of HYPE by Summer (primary coach: Summer)
 *   client2@demo.hypebysummer.com  client of HYPE by Summer (primary coach: Marcus)
 *   owner@ironworks.demo           owner of Ironworks Strength
 *   lifter@ironworks.demo          client of Ironworks Strength
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
const db = createClient<Database>(url, key, { auth: { persistSession: false } });
const PASSWORD = "trainhard123";
type Tables = Database["public"]["Tables"];

async function ensureUser(email: string, fullName: string, timezone = "America/Denver"): Promise<string> {
  const { data: existing } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  await db.from("profiles").update({ timezone }).eq("id", data.user.id);
  return data.user.id;
}

function must<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  if (res.data == null) throw new Error("no data returned");
  return res.data as NonNullable<T>;
}

async function ensureBusiness(row: Tables["businesses"]["Insert"] & { slug: string }): Promise<string> {
  const { data: existing } = await db.from("businesses").select("id").eq("slug", row.slug).maybeSingle();
  if (existing) return existing.id;
  return must(await db.from("businesses").insert(row).select("id").single()).id;
}

async function ensureMember(row: Tables["business_members"]["Insert"]) {
  must(await db.from("business_members").upsert(row, { onConflict: "business_id,user_id" }).select("user_id"));
}

async function ensureClient(businessId: string, clientId: string, extra: Partial<Tables["business_clients"]["Insert"]> = {}) {
  must(
    await db
      .from("business_clients")
      .upsert({ business_id: businessId, client_id: clientId, status: "active", ...extra }, { onConflict: "business_id,client_id" })
      .select("client_id"),
  );
  must(await db.rpc("ensure_conversation", { p_business: businessId, p_client: clientId }));
}

function weekdayRules(businessId: string, coachId: string, days: number[], windows: [string, string][]) {
  const rules: Tables["availability_rules"]["Insert"][] = [];
  for (const weekday of days) for (const [start_time, end_time] of windows) rules.push({ business_id: businessId, coach_id: coachId, weekday, start_time, end_time });
  return rules;
}

async function seedSummer() {
  const summer = await ensureUser("coach@demo.hypebysummer.com", "Summer Reyes");
  const marcus = await ensureUser("coach2@demo.hypebysummer.com", "Marcus Lee");
  const jordan = await ensureUser("client@demo.hypebysummer.com", "Jordan Client");
  const priya = await ensureUser("client2@demo.hypebysummer.com", "Priya Patel");

  const biz = await ensureBusiness({
    slug: "summer",
    name: "HYPE by Summer",
    headline: "Strong, confident, and consistent: training that fits your life",
    bio: "Personal training studio helping busy people build strength, lose fat, and actually enjoy the process. In-person in Denver or online anywhere.",
    specialties: ["Strength training", "Fat loss", "Postpartum fitness", "Beginner friendly"],
    certifications: ["NASM-CPT", "Precision Nutrition L1"],
    instagram_handle: "hypebysummer",
    brand_color: "#e11d48",
    font_preset: "athletic",
    default_location: "Summit Strength Gym, 123 Main St, Denver",
    support_email: "coach@demo.hypebysummer.com",
    timezone: "America/Denver",
    cancellation_window_hours: 24,
    late_cancel_fee_cents: 2500,
    no_show_fee_cents: 5000,
    created_by: summer,
  });
  await ensureMember({ business_id: biz, user_id: summer, role: "owner", slug: "summer", title: "Founder & head coach", bio: "NASM-certified coach specialising in strength and postpartum fitness.", specialties: ["Strength", "Postpartum"] });
  await ensureMember({ business_id: biz, user_id: marcus, role: "coach", slug: "marcus", title: "Strength coach", bio: "Former college athlete. Loves teaching the big lifts.", specialties: ["Powerlifting", "Mobility"], invited_by: summer });
  await ensureClient(biz, jordan, { primary_coach_id: summer, goals: "Deadlift 225 lb and run a 10k by summer", tags: ["hybrid", "early-bird"] });
  await ensureClient(biz, priya, { primary_coach_id: marcus, goals: "First pull-up and better posture", tags: ["in-person"] });

  const { count: typeCount } = await db.from("session_types").select("id", { count: "exact", head: true }).eq("business_id", biz);
  if (!typeCount) {
    must(
      await db.from("session_types").insert([
        { business_id: biz, coach_ids: [summer, marcus], slug: "free-consult", name: "Free consultation", description: "20 minutes to talk goals, history and whether we're a fit.", duration_minutes: 20, price_cents: 0, location_type: "virtual", requires_payment: false, is_consultation: true, allow_credits: false, credits_required: 0, sort_order: 0, color: "#0ea5e9" },
        { business_id: biz, coach_ids: [summer, marcus], slug: "personal-training", name: "1:1 Personal training", description: "A fully coached session built around your program.", duration_minutes: 60, price_cents: 9000, location_type: "in_person", location_details: "Summit Strength Gym, 123 Main St, Denver", buffer_after_minutes: 15, sort_order: 1 },
        { business_id: biz, coach_ids: [summer], slug: "virtual-session", name: "Virtual training session", description: "Live coaching over video. All you need is a little space.", duration_minutes: 45, price_cents: 6500, location_type: "virtual", sort_order: 2, color: "#8b5cf6" },
        { business_id: biz, coach_ids: [marcus], slug: "saturday-bootcamp", name: "Saturday bootcamp", description: "High-energy small group class. Max 8.", duration_minutes: 50, price_cents: 2500, capacity: 8, location_type: "in_person", location_details: "Wash Park, south boathouse", sort_order: 3, color: "#f59e0b" },
      ], { defaultToNull: false }).select("id"),
    );
  }
  const { count: ruleCount } = await db.from("availability_rules").select("id", { count: "exact", head: true }).eq("business_id", biz);
  if (!ruleCount) {
    must(
      await db
        .from("availability_rules")
        .insert([
          ...weekdayRules(biz, summer, [1, 2, 3, 4, 5], [["06:00", "11:00"], ["16:00", "19:00"]]),
          ...weekdayRules(biz, marcus, [1, 3, 5], [["12:00", "20:00"]]),
          ...weekdayRules(biz, marcus, [6], [["08:00", "12:00"]]),
        ], { defaultToNull: false })
        .select("id"),
    );
  }

  const { count: offerCount } = await db.from("offerings").select("id", { count: "exact", head: true }).eq("business_id", biz);
  if (!offerCount) {
    must(
      await db.from("offerings").insert([
        { business_id: biz, kind: "package", name: "5-session pack", description: "Five 1:1 sessions to use within 90 days.", price_cents: 42500, credits: 5, credits_expire_days: 90, features: ["Save $25", "Use for in-person or virtual"], sort_order: 1 },
        { business_id: biz, kind: "package", name: "10-session pack", description: "Ten 1:1 sessions to use within 180 days.", price_cents: 80000, credits: 10, credits_expire_days: 180, features: ["Save $100", "Most popular"], featured: true, sort_order: 2 },
        { business_id: biz, kind: "subscription", name: "Online coaching", description: "Custom program, weekly check-ins, form reviews and unlimited messaging.", price_cents: 14900, billing_interval: "month", includes_programming: true, features: ["Personalized program in the app", "Weekly check-in review", "Unlimited form checks", "Chat with your coach"], sort_order: 3 },
        { business_id: biz, kind: "subscription", name: "Hybrid membership", description: "Four 1:1 sessions a month plus full online coaching.", price_cents: 39900, billing_interval: "month", credits: 4, credits_expire_days: 45, includes_programming: true, features: ["4 sessions / month", "Everything in Online coaching"], featured: true, sort_order: 4 },
        { business_id: biz, kind: "one_time", name: "Movement assessment", description: "A 75-minute assessment and written plan.", price_cents: 12500, sort_order: 5 },
      ], { defaultToNull: false }).select("id"),
    );
  }

  let { data: magnet } = await db.from("lead_magnets").select("id").eq("business_id", biz).eq("slug", "summer-shred-starter").maybeSingle();
  if (!magnet) {
    magnet = must(
      await db.from("lead_magnets").insert({
        business_id: biz,
        slug: "summer-shred-starter",
        title: "The 4-Week Summer Starter Plan",
        subtitle: "A free, printable PDF to build strength and momentum, no gym required.",
        description: "Three 30-minute workouts a week, a simple protein-first nutrition guide, and a habit tracker.",
        bullet_points: ["12 follow-along workouts", "Protein-first meal framework", "Printable habit tracker", "Form tips for every move"],
        ask_goal: true,
        ask_phone: true,
      }).select("id").single(),
    );
  }

  // A template program with real exercises from the global library.
  const { data: existingProgram } = await db.from("programs").select("id").eq("business_id", biz).is("client_id", null).limit(1).maybeSingle();
  if (!existingProgram) {
    const { data: ex } = await db.from("exercises").select("id, name").is("business_id", null);
    const byName = new Map((ex ?? []).map((e) => [e.name, e.id]));
    const program = must(
      await db.from("programs").insert({ business_id: biz, coach_id: summer, name: "Foundations of Strength", description: "Full-body, 3 days a week, built for beginners returning to the gym.", goal: "strength", duration_weeks: 4, status: "active" }).select("id").single(),
    );
    const days: [number, string, [string, number, string, string][]][] = [
      [1, "Full body A", [["Goblet Squat", 3, "10", "Moderate"], ["Dumbbell Incline Press", 3, "10", ""], ["Seated Cable Row", 3, "12", ""], ["Dead Bug", 3, "8/side", ""]]],
      [3, "Full body B", [["Romanian Deadlift", 3, "10", ""], ["Push-Up", 3, "AMRAP", "Bodyweight"], ["Lat Pulldown", 3, "12", ""], ["Plank", 3, "30s", ""]]],
      [5, "Full body C", [["Bulgarian Split Squat", 3, "8/side", ""], ["Overhead Press", 3, "8", ""], ["Single-Arm Dumbbell Row", 3, "10/side", ""], ["Farmer Carry", 3, "40 m", "Heavy"]]],
    ];
    for (let week = 1; week <= 4; week++) {
      for (const [day, name, list] of days) {
        const w = must(await db.from("program_workouts").insert({ program_id: program.id, week, day, name, estimated_minutes: 50 }).select("id").single());
        const rows = list.filter(([n]) => byName.has(n)).map(([n, sets, reps, load], i) => ({ workout_id: w.id, exercise_id: byName.get(n)!, sort_order: i, sets, reps, load: load || null, rest_seconds: 90 }));
        if (rows.length) must(await db.from("workout_exercises").insert(rows).select("id"));
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    must(await db.rpc("assign_program", { p_template: program.id, p_client: jordan, p_start: today }));
  }

  // Leads, one assigned to each coach.
  for (const lead of [
    { email: "taylor.lead@example.com", first_name: "Taylor", primary_goal: "lose_fat", source: "lead_magnet", lead_magnet_id: magnet.id, utm_source: "instagram", utm_medium: "social", utm_campaign: "summer-starter", marketing_consent: true },
    { email: "morgan.lead@example.com", first_name: "Morgan", primary_goal: "build_muscle", source: "contact_form", preferred_format: "in_person", timeline: "asap", phone: "555-0142" },
  ]) {
    must(await db.rpc("capture_lead", { p: { business_id: biz, ...lead } }));
  }
  await db.from("leads").update({ assigned_coach_id: summer }).eq("business_id", biz).eq("email", "taylor.lead@example.com").is("assigned_coach_id", null);
  await db.from("leads").update({ assigned_coach_id: marcus }).eq("business_id", biz).eq("email", "morgan.lead@example.com").is("assigned_coach_id", null);
  return biz;
}

/** A second, unrelated business: proves isolation (nothing of Summer's shows here, and vice versa). */
async function seedIronworks() {
  const owner = await ensureUser("owner@ironworks.demo", "Dana Iron", "America/Chicago");
  const lifter = await ensureUser("lifter@ironworks.demo", "Sam Lifter", "America/Chicago");
  const biz = await ensureBusiness({
    slug: "ironworks",
    name: "Ironworks Strength",
    headline: "Barbell strength coaching in Chicago",
    bio: "Small-group powerlifting and strength coaching.",
    specialties: ["Powerlifting", "Strength"],
    brand_color: "#1d4ed8",
    font_preset: "modern",
    support_email: "owner@ironworks.demo",
    timezone: "America/Chicago",
    created_by: owner,
  });
  await ensureMember({ business_id: biz, user_id: owner, role: "owner", slug: "dana", title: "Head coach" });
  await ensureClient(biz, lifter, { primary_coach_id: owner, goals: "500 lb deadlift", tags: ["powerlifting"] });
  const { count } = await db.from("session_types").select("id", { count: "exact", head: true }).eq("business_id", biz);
  if (!count) {
    must(
      await db.from("session_types").insert([
        { business_id: biz, coach_ids: [owner], slug: "strength-session", name: "Strength session", duration_minutes: 60, price_cents: 8000, location_type: "in_person", location_details: "Ironworks, 9 W Lake St, Chicago", sort_order: 1, color: "#1d4ed8" },
      ], { defaultToNull: false }).select("id"),
    );
    must(await db.from("availability_rules").insert(weekdayRules(biz, owner, [1, 2, 3, 4], [["07:00", "13:00"]])).select("id"));
    must(
      await db.from("offerings").insert({ business_id: biz, kind: "package", name: "8-session block", description: "Eight sessions in 8 weeks.", price_cents: 56000, credits: 8, credits_expire_days: 70, sort_order: 1 }).select("id"),
    );
  }
  // Same email as a Summer lead: a separate lead per business.
  must(await db.rpc("capture_lead", { p: { business_id: biz, email: "taylor.lead@example.com", first_name: "Taylor", source: "contact_form" } }));
  return biz;
}

async function main() {
  await seedSummer();
  await seedIronworks();
  const domain = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN || "localhost:3000";
  console.log("Demo data ready.");
  console.log(`  HYPE by Summer  http://summer.${domain}`);
  console.log(`    owner   coach@demo.hypebysummer.com / ${PASSWORD}`);
  console.log(`    coach   coach2@demo.hypebysummer.com / ${PASSWORD}`);
  console.log(`    clients client@demo.hypebysummer.com, client2@demo.hypebysummer.com / ${PASSWORD}`);
  console.log(`  Ironworks       http://ironworks.${domain}`);
  console.log(`    owner   owner@ironworks.demo / ${PASSWORD}`);
  console.log(`    client  lifter@ironworks.demo / ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
