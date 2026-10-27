import "server-only";

// OWNER: leads. First-touch marketing attribution captured on the first visit
// (UTM params, referrer, landing page) and stored in a first-party cookie.

export type Attribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrerUrl?: string;
  landingPage?: string;
  firstSeenAt?: string;
};

/** Reads the attribution cookie for the current request ({} if absent). */
export async function readAttribution(): Promise<Attribution> {
  return {};
}
