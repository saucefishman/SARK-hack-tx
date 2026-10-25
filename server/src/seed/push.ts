// Pushes generated Nessie data into a live Nessie account (H2): customer -> account -> merchants -> purchases/transfers.
// Resumable: when `existing` is given, records already in Nessie (matched by natural key) are reused, not duplicated.
import type { NessieData, NessieWriter } from "../sources/nessie";
import type { NessieSource } from "../sources/types";

const ADDRESS = { street_number: "1", street_name: "Demo St", city: "Austin", state: "TX", zip: "78701" };

/** Creates everything via the writer; returns generated-id -> Nessie-assigned-id map. */
export async function pushNessie(data: NessieData, w: NessieWriter, existing?: NessieSource): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const [customers, accounts, merchants] = existing
    ? await Promise.all([existing.getCustomers(), existing.getAccounts(), existing.getMerchants()])
    : [[], [], []];

  for (const c of data.customers) {
    const found = customers.find((x) => x.first_name === c.first_name && x.last_name === c.last_name);
    ids.set(c._id, found?._id ?? (await w.createCustomer({ first_name: c.first_name, last_name: c.last_name, address: ADDRESS })));
  }
  for (const a of data.accounts) {
    const customerId = ids.get(a.customer_id)!;
    const found = accounts.find((x) => x.customer_id === customerId && x.nickname === a.nickname);
    ids.set(a._id, found?._id ?? (await w.createAccount(customerId, { type: a.type, nickname: a.nickname, rewards: 0, balance: 0 })));
  }
  for (const m of data.merchants) {
    const found = merchants.find((x) => x.name === m.name);
    ids.set(m._id, found?._id ?? (await w.createMerchant({ name: m.name, category: m.category.join(", ") })));
  }
  for (const p of data.purchases) {
    const { _id, payer_id, merchant_id, type: _pt, ...rest } = p; // live API rejects `type`
    const accountId = ids.get(payer_id)!;
    const have = existing ? await existing.getPurchases(accountId) : [];
    const found = have.find((x) => x.purchase_date === p.purchase_date && x.amount === p.amount && x.description === p.description);
    ids.set(_id, found?._id ?? (await w.createPurchase(accountId, { ...rest, merchant_id: ids.get(merchant_id)! })));
  }
  for (const t of data.transfers) {
    const { _id, payer_id } = t;
    const accountId = ids.get(payer_id)!;
    const have = existing ? await existing.getTransfers(accountId) : [];
    const found = have.find((x) => x.transaction_date === t.transaction_date && x.amount === t.amount && x.description === t.description);
    ids.set(_id, found?._id ?? (await w.createTransfer(accountId, {
      // live API accepts only these four fields (no payee); ingest names the friend from `description`
      transaction_date: t.transaction_date, status: t.status ?? "completed", amount: t.amount, description: t.description ?? "",
    })));
  }
  return ids;
}
