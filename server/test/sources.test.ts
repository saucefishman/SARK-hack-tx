import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileCalendarSource } from "../src/sources/calendar";
import { fixMojibake, InstagramMessageSource } from "../src/sources/instagram";
import { NESSIE_PATHS, NessieFileSource, NessieHttpClient } from "../src/sources/nessie";
import { loadPeople } from "../src/sources/people";
import { writeTempSeed } from "./tempSeed";

describe("fixMojibake", () => {
  it("repairs UTF-8 read as latin-1", () => {
    expect(fixMojibake("cafÃ©")).toBe("café");
    expect(fixMojibake("ð\u009f\u008d£")).toBe("\u{1F363}");
  });
  it("leaves valid strings unchanged", () => {
    expect(fixMojibake("plain ascii $30")).toBe("plain ascii $30");
    expect(fixMojibake("café")).toBe("café"); // latin-1 é alone is not valid UTF-8
    expect(fixMojibake("\u{1F363} sushi")).toBe("\u{1F363} sushi");
    expect(fixMojibake("")).toBe("");
  });
});

describe("file sources", () => {
  const dir = writeTempSeed();
  afterEach(() => vi.unstubAllGlobals());

  it("InstagramMessageSource yields sorted, repaired messages with stable ids", async () => {
    const src = new InstagramMessageSource(path.join(dir, "instagram"));
    const a: Awaited<ReturnType<typeof collect>> = await collect(src);
    const b = await collect(src);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    expect(a.map((m) => m.timestampMs)).toEqual([...a.map((m) => m.timestampMs)].sort((x, y) => x - y));
    const cafe = a.find((m) => m.content.includes("grabbing a"))!;
    expect(cafe.content).toBe("omw, grabbing a café first");
    expect(cafe.senderName).toBe("Riles");
    expect(cafe.threadTitle).toBe("Burger Run");
    expect(cafe.participants).toEqual(["Me", "Riley", "Jordan"]);
  });

  it("FileCalendarSource, NessieFileSource, loadPeople", async () => {
    const cal = await new FileCalendarSource(path.join(dir, "calendar.json")).listEvents();
    expect(cal).toHaveLength(12);
    const nes = new NessieFileSource(path.join(dir, "nessie.json"));
    expect((await nes.getCustomers()).length).toBe(5);
    expect((await nes.getPurchases("acct_me")).length).toBe(13);
    expect((await nes.getTransfers("acct_sam")).length).toBe(2); // sender or payee side
    expect((await loadPeople(path.join(dir, "people.json"))).map((p) => p.id)).toContain("p_riley");
  });

  it("NessieHttpClient uses the path map and key query param (no real network)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "POST" ? { objectCreated: { _id: "new1" } } : []), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const c = new NessieHttpClient("https://nessie.test/", "K3Y");
    await c.getPurchases("acc1");
    expect(fetchMock.mock.calls[0][0]).toBe(`https://nessie.test${NESSIE_PATHS.accountPurchases("acc1")}?key=K3Y`);
    expect(fetchMock.mock.calls[0][0]).toContain("/accounts/acc1/purchases");
    const id = await c.createMerchant({ name: "Uchi", category: "restaurant" });
    expect(id).toBe("new1");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
  });
});

async function collect(src: InstagramMessageSource) {
  const out = [];
  for await (const m of src.listMessages()) out.push(m);
  return out;
}
