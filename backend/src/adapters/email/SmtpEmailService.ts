import type { EmailMessage } from '../../domain/email.js';
import { UpstreamError } from '../../errors.js';
import type { EmailService } from '../../ports/EmailService.js';

/** The part of a nodemailer transport this adapter uses. */
export interface MailTransport {
  sendMail(mail: {
    from: string;
    to: string;
    replyTo: { name: string; address: string };
    subject: string;
    text: string;
  }): Promise<unknown>;
}

/**
 * `EmailService` over SMTP via nodemailer (blueprint §5.8): Mailpit locally,
 * Amazon SES SMTP in production. Plain text only, never HTML.
 */
export class SmtpEmailService implements EmailService {
  constructor(private readonly transport: MailTransport) {}

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: message.from,
        to: message.to,
        // Passed as an address object so nodemailer encodes it safely.
        replyTo: { name: message.replyTo.name, address: message.replyTo.address },
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      throw new UpstreamError('Email delivery failed', { cause: error });
    }
  }
}
