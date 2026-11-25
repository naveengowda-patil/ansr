import { type AddressInfo, createServer, type Socket } from 'node:net';
import nodemailer from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type MailTransport, SmtpEmailService } from '../../src/adapters/email/SmtpEmailService.js';
import { smtpTransportOptions } from '../../src/container.js';
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

  it('wraps a transport timeout in UpstreamError', async () => {
    const timeout = Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' });
    const transport: MailTransport = { sendMail: () => Promise.reject(timeout) };

    const failure = await new SmtpEmailService(transport).send(message).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).cause).toBe(timeout);
  });

  describe('against a mail server that accepts the connection but never answers', () => {
    const sockets = new Set<Socket>();
    const silentServer = createServer((socket) => {
      sockets.add(socket); // never write the SMTP greeting
      socket.on('close', () => sockets.delete(socket));
    });
    let port = 0;

    beforeAll(async () => {
      await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
      port = (silentServer.address() as AddressInfo).port;
    });

    afterAll(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => silentServer.close(resolve));
    });

    it('gives up after SMTP_TIMEOUT_MS with UpstreamError instead of hanging (D-010)', async () => {
      const options = smtpTransportOptions({ host: '127.0.0.1', port, secure: false, timeoutMs: 200 });
      const transport = nodemailer.createTransport(options);
      const startedAt = Date.now();

      try {
        await expect(new SmtpEmailService(transport).send(message)).rejects.toBeInstanceOf(UpstreamError);
        expect(Date.now() - startedAt).toBeLessThan(2_000);
      } finally {
        transport.close();
      }
    });
  });
});
