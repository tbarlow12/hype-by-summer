"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { resendInvite } from "../actions";

/** Emails the client a fresh branded sign-in link. */
export function ResendInviteButton({ clientId }: { clientId: string }) {
  return (
    <ActionForm action={resendInvite}>
      <input type="hidden" name="client_id" value={clientId} />
      <SubmitButton size="sm" variant="outline" pendingLabel="Sending…">
        Send sign-in link
      </SubmitButton>
    </ActionForm>
  );
}
