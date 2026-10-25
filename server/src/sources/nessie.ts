// Nessie access: HTTP client (live API) and file source (seed/generated/nessie.json). Both implement NessieSource.
import fs from "node:fs/promises";
import type {
  NessieAccount, NessieCustomer, NessieMerchant, NessiePurchase, NessieSource, NessieTransfer,
} from "./types";

/**
 * All endpoint paths in one place. H6: per-account purchase/transfer list+create routes are
 * UNCONFIRMED in the Nessie docs (only by-id routes are documented). Fix wrong ones here.
 */
export const NESSIE_PATHS = {
  customers: "/customers",
  customerAccounts: (customerId: string) => `/customers/${customerId}/accounts`,
  accounts: "/accounts",
  merchants: "/merchants",
  accountPurchases: (accountId: string) => `/accounts/${accountId}/purchases`, // H6 unconfirmed
  accountTransfers: (accountId: string) => `/accounts/${accountId}/transfers`, // H6 unconfirmed
} as const;

export interface NessieCreateCustomer {
  first_name: string;
  last_name: string;
  address: { street_number: string; street_name: string; city: string; state: string; zip: string };
}

/** Writer half used by `seed --push-nessie`; ids returned are Nessie-assigned. */
export interface NessieWriter {
  createCustomer(body: NessieCreateCustomer): Promise<string>;
  createAccount(customerId: string, body: { type: string; nickname: string; rewards: number; balance: number }): Promise<string>;
  createMerchant(body: { name: string; category: string[] }): Promise<string>;
  createPurchase(accountId: string, body: Omit<NessiePurchase, "_id" | "payer_id">): Promise<string>;
  createTransfer(accountId: string, body: Omit<NessieTransfer, "_id" | "payer_id">): Promise<string>;
}

export class NessieHttpClient implements NessieSource, NessieWriter {
  constructor(private baseUrl: string, private key: string) {}

  private url(p: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${p}?key=${encodeURIComponent(this.key)}`;
  }

  private async get<T>(p: string): Promise<T> {
    const res = await fetch(this.url(p));
    if (!res.ok) throw new Error(`Nessie GET ${p} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async create(p: string, body: unknown): Promise<string> {
    const res = await fetch(this.url(p), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Nessie POST ${p} failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { objectCreated?: { _id: string } };
    const id = j.objectCreated?._id;
    if (!id) throw new Error(`Nessie POST ${p}: no objectCreated._id in response`);
    return id;
  }

  getCustomers() { return this.get<NessieCustomer[]>(NESSIE_PATHS.customers); }
  getAccounts() { return this.get<NessieAccount[]>(NESSIE_PATHS.accounts); }
  getMerchants() { return this.get<NessieMerchant[]>(NESSIE_PATHS.merchants); }
  getPurchases(accountId: string) { return this.get<NessiePurchase[]>(NESSIE_PATHS.accountPurchases(accountId)); }
  getTransfers(accountId: string) { return this.get<NessieTransfer[]>(NESSIE_PATHS.accountTransfers(accountId)); }

  createCustomer(body: NessieCreateCustomer) { return this.create(NESSIE_PATHS.customers, body); }
  createAccount(customerId: string, body: Parameters<NessieWriter["createAccount"]>[1]) {
    return this.create(NESSIE_PATHS.customerAccounts(customerId), body);
  }
  createMerchant(body: { name: string; category: string[] }) { return this.create(NESSIE_PATHS.merchants, body); }
  createPurchase(accountId: string, body: Parameters<NessieWriter["createPurchase"]>[1]) {
    return this.create(NESSIE_PATHS.accountPurchases(accountId), body);
  }
  createTransfer(accountId: string, body: Parameters<NessieWriter["createTransfer"]>[1]) {
    return this.create(NESSIE_PATHS.accountTransfers(accountId), body);
  }
}

export interface NessieData {
  customers: NessieCustomer[];
  accounts: NessieAccount[];
  merchants: NessieMerchant[];
  purchases: NessiePurchase[];
  transfers: NessieTransfer[];
}

/** Reads nessie.json: { customers, accounts, merchants, purchases, transfers }. */
export class NessieFileSource implements NessieSource {
  private cache?: Promise<NessieData>;
  constructor(private file: string) {}
  private data() {
    this.cache ??= fs.readFile(this.file, "utf8").then((s) => JSON.parse(s) as NessieData);
    return this.cache;
  }
  async getCustomers() { return (await this.data()).customers; }
  async getAccounts() { return (await this.data()).accounts; }
  async getMerchants() { return (await this.data()).merchants; }
  async getPurchases(accountId: string) { return (await this.data()).purchases.filter((p) => p.payer_id === accountId); }
  /** Transfers where the account is either side (the live API's behaviour is H6-unconfirmed). */
  async getTransfers(accountId: string) {
    return (await this.data()).transfers.filter((t) => t.payer_id === accountId || t.payee_id === accountId);
  }
}
