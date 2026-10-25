// Source adapter contracts. Pipeline code depends only on these interfaces,
// so swapping Instagram → Muse or file → live Nessie never touches the pipeline.

/** One message as read from an export (Instagram today, Muse later). */
export interface RawMessage {
  /** Stable id: `${threadId}:${timestampMs}:${index}` unless the source has its own. */
  id: string;
  threadId: string;
  threadTitle: string;
  participants: string[];
  senderName: string;
  timestampMs: number;
  content: string;
}

export interface MessageSource {
  listMessages(): AsyncIterable<RawMessage>;
}

/** Google Calendar event shape (subset). */
export interface RawCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime: string };
  end?: { dateTime: string };
  attendees?: { email?: string; displayName?: string }[];
}

export interface CalendarSource {
  listEvents(): Promise<RawCalendarEvent[]>;
}

// Nessie shapes (https://nessieisreal.com/docs). Amounts are whole dollars.
export interface NessieCustomer { _id: string; first_name: string; last_name: string }
export interface NessieAccount { _id: string; customer_id: string; nickname: string; type: string }
export interface NessieMerchant { _id: string; name: string; category: string[] }
export interface NessiePurchase {
  _id: string;
  type?: string;
  merchant_id: string;
  payer_id: string; // account id
  purchase_date: string; // YYYY-MM-DD, no time
  amount: number; // integer dollars
  status?: string;
  medium: string;
  description?: string;
}
export interface NessieTransfer {
  _id: string;
  type?: string;
  transaction_date: string; // YYYY-MM-DD
  status?: string;
  medium: string;
  payer_id: string; // account id
  payee_id: string; // account id (not reliable for identifying friends; parse description)
  amount: number;
  description?: string;
}

export interface NessieSource {
  getCustomers(): Promise<NessieCustomer[]>;
  getAccounts(): Promise<NessieAccount[]>;
  getMerchants(): Promise<NessieMerchant[]>;
  getPurchases(accountId: string): Promise<NessiePurchase[]>;
  getTransfers(accountId: string): Promise<NessieTransfer[]>;
}
