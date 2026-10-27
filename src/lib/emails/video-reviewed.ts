import type { EmailInput } from "@/lib/email";
import { absoluteUrl } from "@/lib/env";

/** Sent to a client when their coach finishes reviewing a form-check video. */
export function videoReviewedEmail(input: {
  to: string;
  clientName?: string | null;
  trainerName: string;
  videoTitle: string;
  commentCount: number;
  submissionId: string;
}): EmailInput {
  const notes =
    input.commentCount === 0
      ? "Open it to see the review."
      : `${input.commentCount} coaching note${input.commentCount === 1 ? "" : "s"} are waiting for you, pinned to the exact moments in your video.`;
  return {
    to: input.to,
    subject: `Your form check "${input.videoTitle}" has been reviewed`,
    heading: "Your form check is reviewed",
    paragraphs: [
      input.clientName ? `Hi ${input.clientName.split(" ")[0]},` : "Hi,",
      `${input.trainerName} reviewed "${input.videoTitle}". ${notes}`,
      "Tap any note to jump to that moment. You can reply right under the video if you have questions.",
    ],
    cta: { label: "See feedback", url: absoluteUrl(`/me/videos/${input.submissionId}`) },
  };
}
