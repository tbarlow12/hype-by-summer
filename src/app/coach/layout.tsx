import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";
import { isManager, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, titleCase } from "@/lib/format";

export default async function CoachLayout({ children }: LayoutProps<"/coach">) {
  const { profile, business, membership } = await requireStaff();
  const supabase = await createClient();
  const manager = isManager(membership);

  const [{ count: pendingVideos }, { count: newLeads }, { data: convos }] = await Promise.all([
    supabase.from("video_submissions").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "pending_review"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "new"),
    supabase.from("conversations").select("last_message_at, staff_last_read_at").eq("business_id", business.id),
  ]);
  const unread = (convos ?? []).filter(
    (c) => c.last_message_at && (!c.staff_last_read_at || c.last_message_at > c.staff_last_read_at),
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
    { href: "/coach/lead-magnets", label: "Lead magnets", section: "Business" },
    ...(manager
      ? [
          { href: "/coach/payments", label: "Payments", section: "Business" },
          { href: "/coach/offerings", label: "Packages & plans", section: "Business" },
          { href: "/coach/broadcasts", label: "Broadcasts", section: "Business" },
          { href: "/coach/team", label: "Team", section: "Business" },
          { href: "/coach/settings", label: "Settings", section: "Business" },
        ]
      : [{ href: "/coach/settings", label: "My profile", section: "Business" }]),
  ];

  return (
    <AppShell
      brandName={business.name}
      logoUrl={business.logo_url}
      nav={nav}
      user={{ name: displayName(profile), avatarUrl: profile.avatar_url, subtitle: titleCase(membership.role) }}
    >
      {children}
    </AppShell>
  );
}
