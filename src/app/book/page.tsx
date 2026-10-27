import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { getPrimaryTrainer } from "@/lib/trainer";

export const metadata = { title: "Book a session" };

export default async function BookIndexPage() {
  const trainer = await getPrimaryTrainer();
  if (trainer) redirect(`/book/${trainer.slug}`);
  return <EmptyState title="Booking isn't open yet" description="Check back soon to book your first session." />;
}
