import "server-only";
import type { Profile } from "@/lib/auth";
import { creditBalance, getTrainerSchedulingInfo, type SessionType } from "./availability";
import { priceLabel } from "./labels";
import { describePolicy, paymentOptions } from "./policy";
import { localDateOf } from "./tz";

/** Server-computed props for <BookingFlow> (everything except the actions). */
export async function bookingFlowProps(input: {
  trainerId: string;
  trainerSlug: string;
  sessionType: SessionType;
  /** Signed-in client (null for guests / non-clients). */
  client: Profile | null;
  /** ISO instant to open the calendar on (e.g. from a waitlist email). */
  focus?: string;
}) {
  const trainer = await getTrainerSchedulingInfo(input.trainerId);
  const tz = input.client?.timezone ?? trainer?.timezone ?? "America/Denver";
  const st = input.sessionType;
  const balance = input.client ? await creditBalance(input.client.id, input.trainerId, st.id) : null;
  const today = localDateOf(new Date(), tz).slice(0, 7);
  const focusMonth = input.focus && !Number.isNaN(Date.parse(input.focus)) ? localDateOf(input.focus, tz).slice(0, 7) : null;
  return {
    trainerSlug: input.trainerSlug,
    sessionSlug: st.slug,
    sessionName: st.name,
    priceLabel: priceLabel(st),
    fallbackTimezone: tz,
    initialMonth: focusMonth && focusMonth > today ? focusMonth : today,
    minMonth: today,
    viewer: input.client
      ? { name: input.client.full_name, email: input.client.email, phone: input.client.phone, smsOptIn: input.client.sms_opt_in }
      : null,
    paymentOptions: paymentOptions(st, balance),
    creditBalance: balance,
    creditsRequired: st.credits_required,
    policyText: trainer ? describePolicy(trainer) : "",
    isGroup: st.capacity > 1,
  };
}
