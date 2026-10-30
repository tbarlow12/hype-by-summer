import type { Metadata } from "next";
import { PLATFORM_NAME } from "@/lib/platform";
import { Section } from "../_components/ui";

export const metadata: Metadata = { title: "Terms & privacy" };

// Plain-language summary. Have a lawyer write the binding terms before launch.
export default function LegalPage() {
  return (
    <Section className="max-w-3xl py-16 sm:py-20">
      <h1 className="text-4xl font-bold sm:text-5xl">Terms &amp; privacy</h1>
      <p className="mt-4 p-muted">The short version of how {PLATFORM_NAME} works with trainers and their clients.</p>
      <div className="mt-10 grid gap-8 text-[15px] leading-relaxed">
        {[
          [
            "Who's who",
            `${PLATFORM_NAME} provides software to fitness businesses ("trainers"). Each trainer runs their own business on it and is responsible for their services, prices, policies and relationship with their clients.`,
          ],
          [
            "Payments",
            "Client payments are processed by Stripe on the trainer's own Stripe account. On the Starter plan a platform fee is deducted from each payment; on Pro the trainer pays a monthly subscription instead. Refunds are issued by the trainer.",
          ],
          [
            "Your data",
            "Trainers own their client list and content. Clients' data is used only to provide the trainer's service: bookings, programs, messages, payments and reminders. We don't sell personal data or market to trainers' clients.",
          ],
          [
            "Email and texts",
            "Messages are sent on behalf of the trainer, in their name. Texts go only to people who opted in; reply STOP to opt out at any time.",
          ],
          [
            "Security",
            "Data is stored with row-level access controls so each business sees only its own records. Card details are handled by Stripe and never touch our servers.",
          ],
          ["Questions", "Contact the business you train with first; trainers can reach us from their dashboard."],
        ].map(([title, body]) => (
          <section key={title}>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="mt-2 p-muted">{body}</p>
          </section>
        ))}
      </div>
    </Section>
  );
}
