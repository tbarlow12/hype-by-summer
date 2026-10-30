// Liability waiver shown to clients before training. This is a general
// template for a personal-training business; the business owner should have
// it reviewed by a lawyer licensed in their state before relying on it.
// Bump WAIVER_VERSION whenever the text changes: clients who signed an older
// version are asked to sign again.

export const WAIVER_VERSION = "2026-10-v1";

export const WAIVER_TITLE = "Assumption of Risk, Release of Liability and Consent to Participate";

export function waiverSections(businessName: string): { heading: string; body: string }[] {
  return [
    {
      heading: "1. Voluntary participation",
      body: `I am voluntarily participating in personal training, group classes, virtual coaching, exercise programs and related activities (the "Activities") offered by ${businessName}, its owner, trainers, employees and contractors (together, the "Trainer").`,
    },
    {
      heading: "2. Health and fitness",
      body: "I confirm that I am in good physical condition and have no medical condition that would prevent my safe participation, other than those I have disclosed in my health intake. I understand that the Trainer is not a physician and does not provide medical advice. I have been advised to consult a physician before beginning any exercise program, and I accept responsibility for doing so. I will promptly tell the Trainer about any change in my health, medications, pregnancy, injuries or symptoms.",
    },
    {
      heading: "3. Assumption of risk",
      body: "I understand that exercise involves inherent risks, including but not limited to muscle strains and sprains, joint and back injuries, fractures, dizziness, fainting, heat illness, abnormal blood pressure or heart rhythm, heart attack, stroke and, in rare cases, death. Risks also arise from equipment, other participants, the training location and, for virtual sessions, my own surroundings and equipment. I knowingly and voluntarily assume all of these risks, known and unknown.",
    },
    {
      heading: "4. My responsibilities",
      body: "I will follow instructions, use equipment properly, work within my own limits, and stop immediately and inform the Trainer if I feel pain, dizziness, shortness of breath, chest discomfort or any other unusual symptom. For virtual and self-guided workouts, I am responsible for providing a safe, clear space and appropriate equipment and for following the program as written.",
    },
    {
      heading: "5. Release and waiver of liability",
      body: "To the fullest extent permitted by law, I release, waive and discharge the Trainer from any and all claims, demands and causes of action for injury, illness, death, or loss or damage to property arising out of or related to my participation in the Activities, including claims arising from the Trainer's ordinary negligence. This release does not apply to gross negligence or willful misconduct.",
    },
    {
      heading: "6. Indemnity",
      body: "I agree to indemnify and hold harmless the Trainer from any loss, liability or cost (including reasonable attorneys' fees) arising from my participation, my breach of this agreement, or any claim brought by me or on my behalf.",
    },
    {
      heading: "7. Emergency medical treatment",
      body: "If I am injured or become ill, I authorize the Trainer to call emergency services and to contact my emergency contact. I am responsible for any resulting medical costs.",
    },
    {
      heading: "8. Photos, video and data",
      body: "Form-check videos, progress photos and workout data I share are used only to coach me and are kept private to me and the Trainer unless I give separate written permission for any other use.",
    },
    {
      heading: "9. General",
      body: "This agreement is intended to be as broad and inclusive as the law permits. If any part is found unenforceable, the rest remains in full force. I am at least 18 years old (or my parent or guardian has also signed), I have read this agreement carefully, I understand it, and I am signing it freely. My typed name below is my electronic signature and has the same effect as a handwritten signature.",
    },
  ];
}
