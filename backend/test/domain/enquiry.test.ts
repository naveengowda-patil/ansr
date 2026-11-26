import { describe, expect, it } from 'vitest';
import { buildEnquiryEmail } from '../../src/domain/enquiry.js';
import { buildProduct } from '../support/fakes.js';

const settings = { salesInboxEmail: 'sales@example.test', mailFrom: 'catalogue@example.test' };
const receivedAt = new Date('2026-11-25T10:00:00.000Z');

describe('buildEnquiryEmail (AC-5, §5.8, D-010)', () => {
  const product = buildProduct({ id: 7, title: 'Silver Ring' });
  const enquiry = { productId: 7, name: 'Jane Doe', email: 'jane@example.test', message: 'Is it in stock?' };

  it('addresses the sales inbox with the customer as reply-to', () => {
    const email = buildEnquiryEmail(product, enquiry, settings, receivedAt);

    expect(email.to).toBe('sales@example.test');
    expect(email.from).toBe('catalogue@example.test');
    expect(email.replyTo).toEqual({ name: 'Jane Doe', address: 'jane@example.test' });
    expect(email.subject).toBe('Product enquiry: Silver Ring');
  });

  it('puts product, customer, timestamp and message in a plain-text body', () => {
    const { text } = buildEnquiryEmail(product, enquiry, settings, receivedAt);

    expect(text).toContain('Product: Silver Ring (ID 7)');
    expect(text).toContain('Name: Jane Doe');
    expect(text).toContain('Email: jane@example.test');
    expect(text).toContain('Received: 2026-11-25T10:00:00.000Z');
    expect(text).toContain('Message:\nIs it in stock?');
    expect(text).not.toMatch(/<[a-z]+[\s>]/i);
  });

  it('says so when there is no message', () => {
    const { text } = buildEnquiryEmail(product, { ...enquiry, message: '   ' }, settings, receivedAt);
    expect(text).toContain('Message:\n(no message)');
  });

  it('strips line breaks from the product title in the subject', () => {
    const tricky = buildProduct({ id: 8, title: 'Ring\r\nBcc: attacker@example.test' });
    const { subject } = buildEnquiryEmail(tricky, enquiry, settings, receivedAt);
    expect(subject).toBe('Product enquiry: Ring Bcc: attacker@example.test');
    expect(subject).not.toMatch(/[\r\n]/);
  });
});
