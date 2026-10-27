import { PublicShell } from "@/components/scheduling/public-shell";

export default function BookLayout({ children }: LayoutProps<"/book">) {
  return <PublicShell>{children}</PublicShell>;
}
