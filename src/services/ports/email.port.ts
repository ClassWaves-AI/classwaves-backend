import type { EmailRecipient, SessionEmailData, ManualResendRequest } from '@classwaves/shared';

export interface EmailPort {
  sendSessionInvitation(recipients: EmailRecipient[], session: SessionEmailData): Promise<{ sent: string[]; failed: string[] }>;
  resendSessionInvitation(request: ManualResendRequest, session: SessionEmailData): Promise<{ sent: string[]; failed: string[] }>;
}

