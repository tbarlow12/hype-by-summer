import type { EmailInput } from "@/lib/email";
import type { Brand } from "@/lib/tenant";

/** Sent to a client when a coach finishes reviewing their form-check video. */
export function videoReviewedEmail(input: {
  brand: Brand;
  to: string;
  clientName?: string | null;
  coachName: string;
  videoTitle: string;
  commentCount: number;
  submissionId: string;
}): EmailInput {
  const notes =
    input.commentCount === 0
      ? "Open it to see the review."
      : `${input.commentCount} coaching note${input.commentCount === 1 ? " is" : "s are"} waiting for you, pinned to the exact moments in your video.`;
  return {
    brand: input.brand,
    to: input.to,
    subject: `Your form check "${input.videoTitle}" has been reviewed`,
    heading: "Your form check is reviewed",
    paragraphs: [
      input.clientName ? `Hi ${input.clientName.split(" ")[0]},` : "Hi,",
      `${input.coachName} reviewed "${input.videoTitle}". ${notes}`,
      "Tap any note to jump to that moment. You can reply right under the video if you have questions.",
    ],
    cta: { label: "See feedback", url: new URL(`/me/videos/${input.submissionId}`, input.brand.siteUrl).toString() },
  };
}
