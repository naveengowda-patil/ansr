import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { type MailTransport, SmtpEmailService } from '../../src/adapters/email/SmtpEmailService.js';
import type { EmailMessage } from '../../src/domain/email.js';
import { UpstreamError } from '../../src/errors.js';

const message: EmailMessage = {
  to: 'sales@example.test',
  from: 'catalogue@example.test',
  replyTo: { name: 'Jane Doe', address: 'jane@example.test' },
  subject: 'Product enquiry: Silver Ring',
  text: 'New product enquiry\n\nMessage:\nIs it in stock?\n',
};

describe('SmtpEmailService (§5.8)', () => {
  it('renders a plain-text email with to, from and reply-to headers', async () => {
    // nodemailer's stream transport builds the real MIME message without any SMTP server.
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const sendMail = vi.spyOn(transport, 'sendMail');

    await new SmtpEmailService(transport).send(message);

    const info: unknown = await sendMail.mock.results[0]?.value;
    const raw = String((info as { message: Buffer }).message);
    expect(raw).toContain('To: sales@example.test');
    expect(raw).toContain('From: catalogue@example.test');
    expect(raw).toContain('Reply-To: Jane Doe <jane@example.test>');
    expect(raw).toContain('Subject: Product enquiry: Silver Ring');
    expect(raw).toMatch(/Content-Type: text\/plain/i);
    expect(raw).not.toMatch(/text\/html/i);
  });

  it('wraps delivery failures in UpstreamError', async () => {
    const transport: MailTransport = { sendMail: () => Promise.reject(new Error('ECONNREFUSED mailpit:1025')) };

    await expect(new SmtpEmailService(transport).send(message)).rejects.toBeInstanceOf(UpstreamError);
  });
});
