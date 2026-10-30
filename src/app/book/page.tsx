import type { Metadata } from "next";
import { Storefront } from "@/components/scheduling/storefront";
import { publicBookingContext } from "@/lib/scheduling/public";

export async function generateMetadata(): Promise<Metadata> {
  const { business } = await publicBookingContext();
  return { title: `Book with ${business.name}` };
}

/** /book[?coach=<id|slug>]: the current business's booking page. */
export default async function BookIndexPage({ searchParams }: PageProps<"/book">) {
  const { coach } = await searchParams;
  return <Storefront coach={typeof coach === "string" ? coach : undefined} />;
}
