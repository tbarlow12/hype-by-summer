import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/format";

export default async function ClientLayout({ children }: LayoutProps<"/me">) {
  const { profile, business } = await requireClient();
  const supabase = await createClient();
  const { data: convo } = await supabase
    .from("conversations")
    .select("last_message_at, client_last_read_at")
    .eq("business_id", business.id)
    .eq("client_id", profile.id)
    .maybeSingle();
  const unread = convo?.last_message_at && (!convo.client_last_read_at || convo.last_message_at > convo.client_last_read_at) ? 1 : 0;

  const nav: NavItem[] = [
    { href: "/me", label: "Home" },
    { href: "/me/book", label: "Book a session" },
    { href: "/me/bookings", label: "My sessions" },
    { href: "/me/plan", label: "My plan" },
    { href: "/me/messages", label: "Messages", count: unread },
    { href: "/me/videos", label: "Form checks" },
    { href: "/me/check-in", label: "Weekly check-in" },
    { href: "/me/progress", label: "Progress" },
    { href: "/me/billing", label: "Billing & credits" },
    { href: "/me/profile", label: "Profile & intake" },
  ];

  return (
    <AppShell
      brandName={business.name}
      logoUrl={business.logo_url}
      businessId={business.id}
      nav={nav}
      user={{ name: displayName(profile), avatarUrl: profile.avatar_url, subtitle: profile.email }}
    >
      {children}
    </AppShell>
  );
}
