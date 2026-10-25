import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/config";
import { generateSeed, seedFiles, toMojibake } from "../src/seed/generate";
import { equalShares, medianCents, splitEdges } from "../src/seed/oracle";
import { pushNessie } from "../src/seed/push";
import type { NessieWriter } from "../src/sources/nessie";
import { fixMojibake } from "../src/sources/instagram";

const scenario = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "seed/scenario.json"), "utf8"));

describe("generateSeed", () => {
  it("is deterministic (byte-identical files)", () => {
    expect(seedFiles(generateSeed(scenario))).toEqual(seedFiles(generateSeed(scenario)));
  });

  it("committed truth.json matches the generator", () => {
    const onDisk = fs.readFileSync(path.join(REPO_ROOT, "seed/truth.json"), "utf8");
    expect(seedFiles(generateSeed(scenario))["truth.json"]).toBe(onDisk);
  });

  it("covers all 12 scenarios, 22 events, both directions", () => {
    const { truth } = generateSeed(scenario);
    const covered = new Set(truth.events.flatMap((e) => e.scenarios));
    for (let i = 1; i <= 12; i++) expect(covered.has(i), `scenario ${i}`).toBe(true);
    expect(truth.events.length).toBe(22);
    for (const f of Object.values(truth.friends)) {
      expect(f.spentOnYouCents).toBeGreaterThan(0);
      expect(f.youSpentOnThemCents).toBeGreaterThan(0);
    }
  });

  it("writes a mojibake string that fixMojibake repairs", () => {
    const { instagramThreads } = generateSeed(scenario);
    const all = instagramThreads.flatMap((t) => t.file.messages.map((m) => m.content));
    expect(all).toContain("omw, grabbing a cafÃ© first");
    expect(all.map(fixMojibake)).toContain("omw, grabbing a café first");
    expect(toMojibake("café")).toBe("cafÃ©");
  });

  it("writes instagram messages newest first", () => {
    const { instagramThreads } = generateSeed(scenario);
    for (const t of instagramThreads) {
      const ts = t.file.messages.map((m) => m.timestamp_ms);
      expect(ts).toEqual([...ts].sort((a, b) => b - a));
    }
  });

  // Hand-computed truth (cents). Balance: positive = friend owes Me.
  it("matches hand-computed friend totals", () => {
    const { friends } = generateSeed(scenario).truth;
    // Alex: spent on Me = brunch 90/3 = 3000 + kayak (web estimate $25 x 2 / 2) 2500 = 5500. (Concert 7500 is assumed -> possible only.)
    //   Me spent on Alex = ember1 60/3 2000 + uchi1 120/4 3000 + ember2 90/3 3000 + lunch 45/3 1500
    //     + tacos 48/4 1200 + uchi2 150/5 3000 + rounding 10000/3 -> 3334 (p_alex sorts first) = 17034.
    //   Repayment Alex->Me 3000.  balance = 17034 - 5500 - 3000 = 8534.
    expect(friends.p_alex).toEqual({ spentOnYouCents: 5500, youSpentOnThemCents: 17034, balanceCents: 8534, possibleCents: 7500 });
    // Sam: spent on Me = lenoir 84/3 2800 + two-payers 1750 + coffee 12/2 600
    //     + karaoke (RAG estimate $20 x 3 / 3) 2000 = 7150.
    //   Me on Sam = uchi1 3000 + dinner 60/3 2000 + ember3 72/3 2400 + tacos 1200 + uchi2 3000 = 11600.
    //   Repayments: Sam->Me 3000 (-), Me->Sam 2800 (+).  balance = 11600 - 7150 - 3000 + 2800 = 4250.
    expect(friends.p_sam).toEqual({ spentOnYouCents: 7150, youSpentOnThemCents: 11600, balanceCents: 4250, possibleCents: 0 });
    // Jordan: on Me = bar (estimated median(60,90,72)=72 -> 72/3) 2400 + pizza 66/3 2200 = 4600.
    //   Me on Jordan = ember1 2000 + uchi1 3000 + dinner 2000 + burgers 54/3 1800 + uchi2 3000 = 11800.
    //   Repayment Jordan->Me 6000.  balance = 11800 - 4600 - 6000 = 1200.
    expect(friends.p_jordan).toEqual({ spentOnYouCents: 4600, youSpentOnThemCents: 11800, balanceCents: 1200, possibleCents: 0 });
    // Riley: on Me = two-payers 750.
    //   Me on Riley = ember2 3000 + lunch 1500 + ember3 2400 + tacos 1200 + burgers 1800 + uchi2 3000
    //     + alamo 48/2 2400 + rounding 3333 = 18633.  balance = 18633 - 750 = 17883.
    expect(friends.p_riley).toEqual({ spentOnYouCents: 750, youSpentOnThemCents: 18633, balanceCents: 17883, possibleCents: 0 });
  });

  it("encodes special events", () => {
    const { truth } = generateSeed(scenario);
    const ev = (k: string) => truth.events.find((e) => e.key === k)!;
    // Scenario 5: estimate = median(60,90,72)*100 = 7200
    expect(ev("s05-jordan-got-this").payers).toEqual([{ personId: "p_jordan", amountCents: 7200, basis: "estimated" }]);
    // RAG case: $20 a head (earlier message) x 3 = 6000, Sam -> Me 2000 estimated; web case: $25 x 2 = 5000, Alex -> Me 2500 estimated
    expect(ev("x-sam-karaoke-rag")).toMatchObject({ totalCents: 6000, ledger: [{ payerId: "p_sam", beneficiaryId: "p_me", amountCents: 2000, basis: "estimated" }] });
    expect(ev("x-alex-kayak-web")).toMatchObject({ totalCents: 5000, ledger: [{ payerId: "p_alex", beneficiaryId: "p_me", amountCents: 2500, basis: "estimated" }] });
    // Scenario 6: 75 * 4 attendees = 30000 total; share 7500 assumed Alex -> Me
    expect(ev("s06-concert").ledger).toEqual([{ payerId: "p_alex", beneficiaryId: "p_me", amountCents: 7500, kind: "covered", basis: "assumed" }]);
    // Scenario 10 and 9: no ledger, not relevant
    expect(ev("s10-txn-only")).toMatchObject({ relevant: false, ledger: [] });
    expect(ev("s09-grocery")).toMatchObject({ relevant: false, ledger: [] });
    expect(truth.reviewItems).toEqual([
      { kind: "attendees", eventKey: "s10-txn-only", nessieId: "pur_s10-txn-only" },
      { kind: "payer", eventKey: "s06-concert" },
    ]);
    // Scenario 11: taco total stays 4800 despite $120 and $25 mentions
    expect(ev("s11-taco-night").totalCents).toBe(4800);
  });
});

describe("oracle", () => {
  it("equalShares gives remainder cents to lowest ids", () => {
    expect(equalShares(10000, ["p_riley", "p_me", "p_alex"])).toEqual({ p_alex: 3334, p_me: 3333, p_riley: 3333 });
  });
  it("multi-payer: 60 + 40 over 4, Me owes pro rata to surplus", () => {
    const edges = splitEdges(["p_me", "p_alex", "p_sam", "p_riley"], [
      { personId: "p_sam", amountCents: 6000 }, { personId: "p_riley", amountCents: 4000 },
    ], "p_me");
    // share 2500; surplus Sam 3500, Riley 1500; Me debt 2500 -> 1750 / 750
    expect(edges).toEqual([
      { payerId: "p_riley", beneficiaryId: "p_me", amountCents: 750 },
      { payerId: "p_sam", beneficiaryId: "p_me", amountCents: 1750 },
    ]);
  });
  it("friend debtors are ignored; only the edge touching the user remains", () => {
    // total 1000 over x,y,z: shares 334,333,333; z owes 333 to x (only creditor); y owes x too but is ignored
    const edges = splitEdges(["x", "y", "z"], [{ personId: "x", amountCents: 700 }, { personId: "y", amountCents: 300 }], "z");
    expect(edges.reduce((s, e) => s + e.amountCents, 0)).toBe(333);
  });
  it("medianCents", () => {
    expect(medianCents([6000, 9000, 7200])).toBe(7200);
    expect(medianCents([100, 201])).toBe(150);
  });
});

describe("pushNessie", () => {
  it("creates customers, accounts, merchants, then purchases and transfers, remapping ids", async () => {
    const calls: string[] = [];
    let n = 0;
    const id = (p: string) => `${p}${++n}`;
    const w: NessieWriter = {
      createCustomer: async (b) => (calls.push(`customer:${b.first_name}`), id("C")),
      createAccount: async (c) => (calls.push(`account:${c}`), id("A")),
      createMerchant: async (b) => (calls.push(`merchant:${b.name}`), id("M")),
      createPurchase: async (a, b) => (calls.push(`purchase:${a}:${b.merchant_id}`), id("P")),
      createTransfer: async (a, b) => (calls.push(`transfer:${a}:${b.description}`), id("T")),
    };
    const { nessie } = generateSeed(scenario);
    await pushNessie(nessie, w);
    const kinds = calls.map((c) => c.split(":")[0]);
    expect(kinds.slice(0, 5)).toEqual(Array(5).fill("customer"));
    expect(kinds.indexOf("account")).toBe(5);
    expect(kinds.lastIndexOf("merchant")).toBeLessThan(kinds.indexOf("purchase"));
    expect(kinds.lastIndexOf("purchase")).toBeLessThan(kinds.indexOf("transfer"));
    expect(calls.filter((c) => c.startsWith("purchase")).every((c) => /^purchase:A\d+:M\d+$/.test(c))).toBe(true);
    expect(calls.length).toBe(5 + 5 + nessie.merchants.length + 13 + 2);
  });
});
