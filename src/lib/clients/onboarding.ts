// Client onboarding checklist shown on /me until everything is done.
import { intakeComplete } from "./intake";
import { WAIVER_VERSION } from "./waiver";

export type OnboardingStep = {
  key: "profile" | "intake" | "waiver" | "book";
  title: string;
  description: string;
  href: string;
  done: boolean;
};

export function onboardingSteps(input: {
  profile: { full_name: string | null; phone: string | null };
  intake: Parameters<typeof intakeComplete>[0] & { waiver_accepted_at: string | null; waiver_version: string | null } | null;
  hasBooking: boolean;
}): OnboardingStep[] {
  const { profile, intake, hasBooking } = input;
  return [
    {
      key: "profile",
      title: "Complete your profile",
      description: "Your name, phone and timezone so reminders arrive at the right time.",
      href: "/me/profile#profile",
      done: !!profile.full_name?.trim() && !!profile.phone?.trim(),
    },
    {
      key: "intake",
      title: "Fill out your health intake",
      description: "A few readiness questions, injuries and goals so your coach can plan safely.",
      href: "/me/profile#intake",
      done: intakeComplete(intake),
    },
    {
      key: "waiver",
      title: "Sign the liability waiver",
      description: "Required before your first session.",
      href: "/me/profile#waiver",
      done: waiverCurrent(intake),
    },
    {
      key: "book",
      title: "Book your first session",
      description: "Pick a time that works for you.",
      href: "/me/book",
      done: hasBooking,
    },
  ];
}

export function waiverCurrent(intake: { waiver_accepted_at: string | null; waiver_version: string | null } | null | undefined) {
  return !!intake?.waiver_accepted_at && intake.waiver_version === WAIVER_VERSION;
}

/** Profile + intake + waiver: the paperwork part (sets profiles.onboarded_at). */
export function paperworkDone(steps: OnboardingStep[]): boolean {
  return steps.filter((s) => s.key !== "book").every((s) => s.done);
}
