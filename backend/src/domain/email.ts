/** A provider-agnostic outgoing email (blueprint §5.4). Plain text only. */
export interface EmailAddress {
  readonly name: string;
  readonly address: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly from: string;
  readonly replyTo: EmailAddress;
  readonly subject: string;
  readonly text: string;
}
