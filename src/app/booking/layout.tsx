import { PublicShell } from "@/components/scheduling/public-shell";

export default function BookingLayout({ children }: LayoutProps<"/booking">) {
  return <PublicShell>{children}</PublicShell>;
}
