import "server-only";
import type { Profile } from "@/lib/auth";
import type { Business } from "@/lib/tenant";
import type { CoachOption } from "@/components/scheduling/booking-flow";
import { coachesForType, creditBalance, policyOf, type Coach, type SessionType } from "./availability";
import { priceLabel } from "./labels";
import { describePolicy, paymentOptions } from "./policy";
import { localDateOf } from "./tz";

export type { CoachOption };

/** "any" or a coach id from the type's coaches; anything else falls back to "any". */
export function pickInitialCoach(requested: string | undefined | null, options: CoachOption[], coaches: Coach[]): string {
  if (!requested) return options.length === 1 ? options[0]!.id : "any";
  const match = options.find((o) => o.id === requested) ?? options.find((o) => coaches.find((c) => c.id === o.id)?.slug === requested.toLowerCase());
  return match?.id ?? (options.length === 1 ? options[0]!.id : "any");
}

/** Server-computed props for <BookingFlow> (everything except the actions). */
export async function bookingFlowProps(input: {
  business: Business;
  sessionType: SessionType;
  /** Bookable coaches of the business. */
  coaches: Coach[];
  /** Signed-in client (null for guests / non-clients). */
  client: Profile | null;
  /** Coach id or coach slug to preselect (e.g. ?coach= from a waitlist email). */
  coach?: string;
  /** ISO instant to open the calendar on (e.g. from a waitlist email). */
  focus?: string;
}) {
  const { business, sessionType: st } = input;
  const tz = input.client?.timezone ?? business.timezone;
  const balance = input.client ? await creditBalance(input.client.id, business.id, st.id) : null;
  const today = localDateOf(new Date(), tz).slice(0, 7);
  const focusMonth = input.focus && !Number.isNaN(Date.parse(input.focus)) ? localDateOf(input.focus, tz).slice(0, 7) : null;
  const coachOptions: CoachOption[] = coachesForType(st, input.coaches).map((c) => ({ id: c.id, name: c.name, title: c.title, avatarUrl: c.avatarUrl }));
  return {
    sessionSlug: st.slug,
    sessionName: st.name,
    priceLabel: priceLabel(st),
    fallbackTimezone: tz,
    initialMonth: focusMonth && focusMonth > today ? focusMonth : today,
    minMonth: today,
    coaches: coachOptions,
    initialCoach: pickInitialCoach(input.coach, coachOptions, input.coaches),
    viewer: input.client
      ? { name: input.client.full_name, email: input.client.email, phone: input.client.phone, smsOptIn: input.client.sms_opt_in }
      : null,
    paymentOptions: paymentOptions(st, balance, business.stripe_charges_enabled),
    creditBalance: balance,
    creditsRequired: st.credits_required,
    policyText: describePolicy(policyOf(business)),
    isGroup: st.capacity > 1,
  };
}
