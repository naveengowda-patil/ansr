import type { EmailMessage } from '../domain/email.js';

/** Sends email (blueprint §5.4). Throws `UpstreamError` when delivery fails. */
export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}
