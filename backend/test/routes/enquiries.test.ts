import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/errors.js';
import { buildProduct } from '../support/fakes.js';
import { createTestApp } from '../support/testApp.js';

const catalogue = [buildProduct({ id: 7, title: 'Silver Ring' })];
const valid = { productId: 7, name: 'Jane Doe', email: 'jane@example.test', message: 'Is it in stock?' };

/** Serialises log entries the way JsonLogger would, including error messages and causes. */
function serializeLogs(entries: readonly unknown[]): string {
  return JSON.stringify(entries, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause } : value,
  );
}

function setup() {
  return createTestApp({ products: catalogue });
}

describe('POST /enquiries (AC-5, §6.9, D-010)', () => {
  it('sends the email to the sales inbox and returns 200 sent', async () => {
    const { app, emailService } = setup();
    const response = await request(app).post('/enquiries').send(valid);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'sent' });
    expect(emailService.sent).toHaveLength(1);
    expect(emailService.sent[0]).toMatchObject({
      to: 'sales@example.test',
      from: 'catalogue@example.test',
      replyTo: { name: 'Jane Doe', address: 'jane@example.test' },
      subject: 'Product enquiry: Silver Ring',
    });
    expect(emailService.sent[0]?.text).toContain('Is it in stock?');
  });

  it('accepts an enquiry without a message and trims name and email', async () => {
    const { app, emailService } = setup();
    const response = await request(app)
      .post('/enquiries')
      .send({ productId: 7, name: '  Jane Doe ', email: ' jane@example.test ' });

    expect(response.status).toBe(200);
    expect(emailService.sent[0]?.replyTo).toEqual({ name: 'Jane Doe', address: 'jane@example.test' });
    expect(emailService.sent[0]?.text).toContain('(no message)');
  });

  it('logs the product id only, never customer details', async () => {
    const { app, logger } = setup();
    await request(app).post('/enquiries').send(valid);

    expect(logger.withMessage('enquiry.sent')).toEqual([
      { level: 'info', message: 'enquiry.sent', context: { productId: 7 } },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('jane@example.test');
  });

  it.each([
    ['missing productId', { name: 'Jane', email: 'jane@example.test' }],
    ['missing name', { productId: 7, email: 'jane@example.test' }],
    ['missing email', { productId: 7, name: 'Jane' }],
    ['blank name', { ...valid, name: '   ' }],
    ['name over 100 chars', { ...valid, name: 'x'.repeat(101) }],
    ['invalid email', { ...valid, email: 'not-an-email' }],
    ['message over 2000 chars', { ...valid, message: 'x'.repeat(2001) }],
    ['productId as string', { ...valid, productId: '7' }],
    ['unknown field', { ...valid, phone: '123' }],
    ['CR/LF in name', { ...valid, name: 'Jane\r\nBcc: attacker@example.test' }],
    ['trailing LF in name', { ...valid, name: 'Jane\n' }],
    ['CR/LF in email', { ...valid, email: 'jane@example.test\r\nBcc: attacker@example.test' }],
    // Control characters other than CR/LF (§6.9). The rule already blocks them; these prove it.
    ['a tab in name', { ...valid, name: 'Jane\tDoe' }],
    ['\\u0000 in name', { ...valid, name: 'Jane\u0000Doe' }],
    ['\\u007F in name', { ...valid, name: 'Jane\u007FDoe' }],
    ['a tab in email', { ...valid, email: 'jane\t@example.test' }],
    ['\\u0000 in email', { ...valid, email: 'jane@example.test\u0000' }],
    ['\\u007F in email', { ...valid, email: 'jane\u007F@example.test' }],
    // productId must be a positive integer JSON number (§6.9, §7.5).
    ['productId 7.5', { ...valid, productId: 7.5 }],
    ['productId 0', { ...valid, productId: 0 }],
    ['productId -1', { ...valid, productId: -1 }],
  ])('rejects %s with 400 and sends nothing', async (_label, body) => {
    const { app, emailService } = setup();
    const response = await request(app).post('/enquiries').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(emailService.sent).toEqual([]);
  });

  it('allows line breaks in the message (it only goes in the body)', async () => {
    const { app } = setup();
    const response = await request(app).post('/enquiries').send({ ...valid, message: 'Line one\nLine two' });

    expect(response.status).toBe(200);
  });

  it('rejects a body that is not a JSON object', async () => {
    const { app } = setup();
    const response = await request(app).post('/enquiries').send([valid]);

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Request body must be a JSON object.');
  });

  it('returns 404 for an unknown product', async () => {
    const { app, emailService } = setup();
    const response = await request(app).post('/enquiries').send({ ...valid, productId: 999 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Product not found.' } });
    expect(emailService.sent).toEqual([]);
  });

  it('keeps customer data out of the logs when sending fails (502)', async () => {
    const { app, emailService, logger } = setup();
    emailService.failure = new UpstreamError('Email delivery failed', {
      cause: Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }),
    });
    const enquiry = { productId: 7, name: 'Zelda Quixote', email: 'zelda.q@example.test', message: 'Secret note 4821' };

    const response = await request(app).post('/enquiries').send(enquiry);

    expect(response.status).toBe(502);
    expect(logger.withMessage('request.failed')).toHaveLength(1);
    const logged = serializeLogs(logger.entries);
    for (const customerValue of [enquiry.name, enquiry.email, enquiry.message, 'Zelda', 'zelda.q']) {
      expect(logged).not.toContain(customerValue);
    }
  });

  it('returns 502 without provider details when sending fails', async () => {
    const { app, emailService } = setup();
    emailService.failure = new UpstreamError('Email delivery failed: ECONNREFUSED mailpit:1025');
    const response = await request(app).post('/enquiries').send(valid);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('UPSTREAM_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('mailpit');
  });
});
