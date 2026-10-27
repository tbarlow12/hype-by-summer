/**
 * Creates demo accounts and data in a Supabase project so every screen has
 * something to show. Safe to re-run (skips what already exists).
 *
 *   npm run seed:demo        # reads .env.local
 *
 * Accounts (password: "trainhard123"):
 *   coach@demo.hypebysummer.com   — trainer (business owner)
 *   client@demo.hypebysummer.com  — client
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
const SLUG = process.env.NEXT_PUBLIC_PRIMARY_TRAINER_SLUG ?? "summer";

async function ensureUser(email: string, fullName: string): Promise<string> {
  const { data: existing } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

function must<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  if (res.data == null) throw new Error("no data returned");
  return res.data as NonNullable<T>;
}

async function main() {
  const coachId = await ensureUser("coach@demo.hypebysummer.com", "Summer Coach");
  // The very first account becomes the trainer automatically; make sure even if not first.
  await db.from("profiles").update({ role: "trainer", timezone: "America/Denver" }).eq("id", coachId);
  const clientId = await ensureUser("client@demo.hypebysummer.com", "Jordan Client");

  await db.from("trainer_profiles").upsert(
    {
      trainer_id: coachId,
      slug: SLUG,
      business_name: "Hype by Summer",
      headline: "Strong, confident, and consistent: training that fits your life",
      bio: "Certified personal trainer helping busy people build strength, lose fat, and actually enjoy the process. In-person in Denver or online anywhere.",
      specialties: ["Strength training", "Fat loss", "Postpartum fitness", "Beginner friendly"],
      certifications: ["NASM-CPT", "Precision Nutrition L1"],
      instagram_handle: "hypebysummer",
      cancellation_window_hours: 24,
      late_cancel_fee_cents: 2500,
      no_show_fee_cents: 5000,
    },
    { onConflict: "trainer_id" },
  );

  await db.from("trainer_clients").upsert(
    { trainer_id: coachId, client_id: clientId, status: "active", goals: "Deadlift 225 lb and run a 10k by summer", tags: ["hybrid", "early-bird"] },
    { onConflict: "trainer_id,client_id" },
  );
  await db.rpc("ensure_conversation", { p_trainer: coachId, p_client: clientId });

  const { count: typeCount } = await db.from("session_types").select("id", { count: "exact", head: true }).eq("trainer_id", coachId);
  if (!typeCount) {
    must(
      await db.from("session_types").insert([
        { trainer_id: coachId, slug: "free-consult", name: "Free consultation", description: "20 minutes to talk goals, history and whether we're a fit.", duration_minutes: 20, price_cents: 0, location_type: "virtual", requires_payment: false, is_consultation: true, allow_credits: false, credits_required: 0, sort_order: 0, color: "#0ea5e9" },
        { trainer_id: coachId, slug: "personal-training", name: "1:1 Personal training", description: "A fully coached session built around your program.", duration_minutes: 60, price_cents: 9000, location_type: "in_person", location_details: "Summit Strength Gym, 123 Main St, Denver", buffer_after_minutes: 15, sort_order: 1 },
        { trainer_id: coachId, slug: "virtual-session", name: "Virtual training session", description: "Live coaching over video. All you need is a little space.", duration_minutes: 45, price_cents: 6500, location_type: "virtual", sort_order: 2, color: "#8b5cf6" },
        { trainer_id: coachId, slug: "saturday-bootcamp", name: "Saturday bootcamp", description: "High-energy small group class. Max 8.", duration_minutes: 50, price_cents: 2500, capacity: 8, location_type: "in_person", location_details: "Wash Park, south boathouse", sort_order: 3, color: "#f59e0b" },
      ], { defaultToNull: false }).select(),
    );
    const rules: Database["public"]["Tables"]["availability_rules"]["Insert"][] = [];
    for (const weekday of [1, 2, 3, 4, 5]) {
      rules.push({ trainer_id: coachId, weekday, start_time: "06:00", end_time: "11:00" });
      rules.push({ trainer_id: coachId, weekday, start_time: "16:00", end_time: "19:00" });
    }
    rules.push({ trainer_id: coachId, weekday: 6, start_time: "08:00", end_time: "10:00" });
    must(await db.from("availability_rules").insert(rules).select());
  }

  const { count: offerCount } = await db.from("offerings").select("id", { count: "exact", head: true }).eq("trainer_id", coachId);
  if (!offerCount) {
    must(
      await db.from("offerings").insert([
        { trainer_id: coachId, kind: "package", name: "5-session pack", description: "Five 1:1 sessions to use within 90 days.", price_cents: 42500, credits: 5, credits_expire_days: 90, features: ["Save $25", "Use for in-person or virtual"], sort_order: 1 },
        { trainer_id: coachId, kind: "package", name: "10-session pack", description: "Ten 1:1 sessions to use within 180 days.", price_cents: 80000, credits: 10, credits_expire_days: 180, features: ["Save $100", "Most popular"], featured: true, sort_order: 2 },
        { trainer_id: coachId, kind: "subscription", name: "Online coaching", description: "Custom program, weekly check-ins, form reviews and unlimited messaging.", price_cents: 14900, billing_interval: "month", includes_programming: true, features: ["Personalized program in the app", "Weekly check-in review", "Unlimited form checks", "Chat with your coach"], sort_order: 3 },
        { trainer_id: coachId, kind: "subscription", name: "Hybrid membership", description: "Four 1:1 sessions a month plus full online coaching.", price_cents: 39900, billing_interval: "month", credits: 4, credits_expire_days: 45, includes_programming: true, features: ["4 sessions / month", "Everything in Online coaching"], featured: true, sort_order: 4 },
        { trainer_id: coachId, kind: "one_time", name: "Movement assessment", description: "A 75-minute assessment and written plan.", price_cents: 12500, sort_order: 5 },
      ], { defaultToNull: false }).select(),
    );
  }

  const { data: magnet } = await db.from("lead_magnets").select("id").eq("slug", "summer-shred-starter").maybeSingle();
  if (!magnet) {
    must(
      await db.from("lead_magnets").insert({
        trainer_id: coachId,
        slug: "summer-shred-starter",
        title: "The 4-Week Summer Starter Plan",
        subtitle: "A free, printable PDF to build strength and momentum, no gym required.",
        description: "Three 30-minute workouts a week, a simple protein-first nutrition guide, and a habit tracker.",
        bullet_points: ["12 follow-along workouts", "Protein-first meal framework", "Printable habit tracker", "Form tips for every move"],
        ask_goal: true,
        ask_phone: true,
      }).select(),
    );
  }

  // A template program with real exercises.
  const { data: existingProgram } = await db.from("programs").select("id").eq("trainer_id", coachId).is("client_id", null).limit(1).maybeSingle();
  if (!existingProgram) {
    const { data: ex } = await db.from("exercises").select("id, name").is("trainer_id", null);
    const byName = new Map((ex ?? []).map((e) => [e.name, e.id]));
    const program = must(
      await db.from("programs").insert({ trainer_id: coachId, name: "Foundations of Strength", description: "Full-body, 3 days a week, built for beginners returning to the gym.", goal: "strength", duration_weeks: 4, status: "active" }).select().single(),
    );
    const days: [number, string, [string, number, string, string][]][] = [
      [1, "Full body A", [["Goblet Squat", 3, "10", "Moderate"], ["Dumbbell Incline Press", 3, "10", ""], ["Seated Cable Row", 3, "12", ""], ["Dead Bug", 3, "8/side", ""]]],
      [3, "Full body B", [["Romanian Deadlift", 3, "10", ""], ["Push-Up", 3, "AMRAP", "Bodyweight"], ["Lat Pulldown", 3, "12", ""], ["Plank", 3, "30s", ""]]],
      [5, "Full body C", [["Bulgarian Split Squat", 3, "8/side", ""], ["Overhead Press", 3, "8", ""], ["Single-Arm Dumbbell Row", 3, "10/side", ""], ["Farmer Carry", 3, "40 m", "Heavy"]]],
    ];
    for (let week = 1; week <= 4; week++) {
      for (const [day, name, list] of days) {
        const w = must(await db.from("program_workouts").insert({ program_id: program.id, week, day, name, estimated_minutes: 50 }).select().single());
        must(
          await db.from("workout_exercises").insert(
            list.filter(([n]) => byName.has(n)).map(([n, sets, reps, load], i) => ({ workout_id: w.id, exercise_id: byName.get(n)!, sort_order: i, sets, reps, load: load || null, rest_seconds: 90 })),
          ).select(),
        );
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    must(await db.rpc("assign_program", { p_template: program.id, p_client: clientId, p_start: today }));
  }

  // A couple of leads so the CRM isn't empty.
  for (const lead of [
    { email: "taylor.lead@example.com", first_name: "Taylor", primary_goal: "lose_fat", source: "lead_magnet", utm_source: "instagram", utm_medium: "social", utm_campaign: "summer-starter", marketing_consent: true },
    { email: "morgan.lead@example.com", first_name: "Morgan", primary_goal: "build_muscle", source: "contact_form", preferred_format: "in_person", timeline: "asap", phone: "555-0142" },
  ]) {
    await db.rpc("capture_lead", { p: { trainer_id: coachId, ...lead } });
  }

  console.log("Demo data ready.");
  console.log(`  Trainer: coach@demo.hypebysummer.com / ${PASSWORD}`);
  console.log(`  Client:  client@demo.hypebysummer.com / ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
