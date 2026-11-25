import type { EmailMessage } from './email.js';
import type { Product } from './product.js';

/** A validated enquiry (blueprint §6.9). */
export interface Enquiry {
  readonly productId: number;
  readonly name: string;
  readonly email: string;
  readonly message?: string | undefined;
}

export interface EnquiryEmailSettings {
  readonly salesInboxEmail: string;
  readonly mailFrom: string;
}

/** Replaces any run of line breaks with a single space so the value is safe in a header. */
export function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/** Builds the plain-text sales email for an enquiry (blueprint §5.8, D-010). */
export function buildEnquiryEmail(
  product: Product,
  enquiry: Enquiry,
  settings: EnquiryEmailSettings,
  receivedAt: Date,
): EmailMessage {
  const message = enquiry.message?.trim() ? enquiry.message.trim() : '(no message)';
  const text = [
    'New product enquiry',
    '',
    `Product: ${product.title} (ID ${product.id})`,
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    `Received: ${receivedAt.toISOString()}`,
    '',
    'Message:',
    message,
    '',
  ].join('\n');

  return {
    to: settings.salesInboxEmail,
    from: settings.mailFrom,
    replyTo: { name: enquiry.name, address: enquiry.email },
    subject: `Product enquiry: ${stripLineBreaks(product.title)}`,
    text,
  };
}
