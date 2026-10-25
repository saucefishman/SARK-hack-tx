// Pushes generated Nessie data into a live Nessie account (H2): customer -> account -> merchants -> purchases/transfers.
import type { NessieData, NessieWriter } from "../sources/nessie";

const ADDRESS = { street_number: "1", street_name: "Demo St", city: "Austin", state: "TX", zip: "78701" };

/** Creates everything via the writer; returns generated-id -> Nessie-assigned-id map. */
export async function pushNessie(data: NessieData, w: NessieWriter): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const c of data.customers) {
    ids.set(c._id, await w.createCustomer({ first_name: c.first_name, last_name: c.last_name, address: ADDRESS }));
  }
  for (const a of data.accounts) {
    ids.set(a._id, await w.createAccount(ids.get(a.customer_id)!, { type: a.type, nickname: a.nickname, rewards: 0, balance: 0 }));
  }
  for (const m of data.merchants) ids.set(m._id, await w.createMerchant({ name: m.name, category: m.category }));
  for (const p of data.purchases) {
    const { _id, payer_id, merchant_id, ...rest } = p;
    ids.set(_id, await w.createPurchase(ids.get(payer_id)!, { ...rest, merchant_id: ids.get(merchant_id)! }));
  }
  for (const t of data.transfers) {
    const { _id, payer_id, payee_id, ...rest } = t;
    ids.set(_id, await w.createTransfer(ids.get(payer_id)!, { ...rest, payee_id: ids.get(payee_id)! }));
  }
  return ids;
}
