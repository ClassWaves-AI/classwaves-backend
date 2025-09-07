import type { EmailPort } from '../../services/ports/email.port';
import type { EmailRecipient, SessionEmailData, ManualResendRequest } from '@classwaves/shared';

export class EmailServiceAdapter implements EmailPort {
  async sendSessionInvitation(recipients: EmailRecipient[], session: SessionEmailData): Promise<{ sent: string[]; failed: string[] }> {
    const { emailService } = await import('../../services/email.service');
    return emailService.sendSessionInvitation(recipients, session);
  }

  async resendSessionInvitation(request: ManualResendRequest, session: SessionEmailData): Promise<{ sent: string[]; failed: string[] }> {
    const { emailService } = await import('../../services/email.service');
    return emailService.resendSessionInvitation(request, session);
  }
}

export const emailServiceAdapter: EmailPort = new EmailServiceAdapter();

