import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";
import { requireTrainer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";
import { getTenant, getTenantByTrainerId, tenantUrl } from "@/lib/tenant";
import { platformUrl } from "@/lib/platform";

export default async function CoachLayout({ children }: LayoutProps<"/coach">) {
  const profile = await requireTrainer();
  const supabase = await createClient();

  const [{ data: storefront }, { count: pendingVideos }, { count: newLeads }, { data: convos }] = await Promise.all([
    supabase.from("trainer_profiles").select("slug").eq("trainer_id", profile.id).maybeSingle(),
    supabase.from("video_submissions").select("id", { count: "exact", head: true }).eq("trainer_id", profile.id).eq("status", "pending_review"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("trainer_id", profile.id).eq("status", "new"),
    supabase.from("conversations").select("last_message_at, trainer_last_read_at").eq("trainer_id", profile.id),
  ]);

  // First run: the business is created at /start on the platform site, which
  // lives outside this layout so the redirect can't loop.
  if (!storefront) redirect(platformUrl("/start"));

  // Coaches manage their business on their own site; send them there.
  const tenant = await getTenant();
  if (!tenant || tenant.trainer_id !== profile.id) {
    const own = await getTenantByTrainerId(profile.id);
    if (own) redirect(tenantUrl(own, "/coach"));
  }

  const unread = (convos ?? []).filter(
    (c) => c.last_message_at && (!c.trainer_last_read_at || c.last_message_at > c.trainer_last_read_at),
  ).length;

  const nav: NavItem[] = [
    { href: "/coach", label: "Dashboard" },
    { href: "/coach/calendar", label: "Calendar", section: "Schedule" },
    { href: "/coach/availability", label: "Availability", section: "Schedule" },
    { href: "/coach/session-types", label: "Session types", section: "Schedule" },
    { href: "/coach/clients", label: "Clients", section: "People" },
    { href: "/coach/leads", label: "Leads", count: newLeads ?? 0, section: "People" },
    { href: "/coach/messages", label: "Messages", count: unread, section: "People" },
    { href: "/coach/videos", label: "Form checks", count: pendingVideos ?? 0, section: "People" },
    { href: "/coach/check-ins", label: "Check-ins", section: "People" },
    { href: "/coach/programs", label: "Programs", section: "Training" },
    { href: "/coach/exercises", label: "Exercise library", section: "Training" },
    { href: "/coach/payments", label: "Payments", section: "Business" },
    { href: "/coach/offerings", label: "Packages & plans", section: "Business" },
    { href: "/coach/lead-magnets", label: "Lead magnets", section: "Business" },
    { href: "/coach/broadcasts", label: "Broadcasts", section: "Business" },
    { href: "/coach/settings", label: "Settings", section: "Business" },
  ];

  return (
    <AppShell nav={nav} user={{ name: displayName(profile), avatarUrl: profile.avatar_url, subtitle: "Coach" }}>
      {children}
    </AppShell>
  );
}
