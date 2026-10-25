// Live smoke test against the Meta Model API (Muse): one tiny messageDay call (structured output) and one webCost
// lookup (web search grounding + extraction). Needs META_API_KEY. Uses an in-memory DB, so nothing is cached for later.
import { getConfig } from "../config";
import { createDb } from "../db/pool";
import { migrate } from "../db/migrate";
import { flushTraces } from "../obs/tracing";
import { generateGrounded, generateStructured, messageDay, webCost } from "../llm";

async function main() {
  const cfg = getConfig({ LLM_MODE: "replay" });
  if (!cfg.META_API_KEY) {
    console.log("META_API_KEY needed");
    return;
  }
  console.log(`model=${cfg.LLM_MODEL} reasoning=${cfg.LLM_REASONING}`);
  const db = createDb("pglite://memory");
  await migrate(db);
  const out = await generateStructured(
    db,
    messageDay,
    {
      threadId: "smoke",
      threadTitle: "Alex",
      date: "2026-03-12",
      people: [
        { id: "p_me", name: "Me" },
        { id: "p_alex", name: "Alex" },
      ],
      messages: [
        { id: "m1", senderId: "p_alex", senderName: "Alex", time: "19:05", text: "dinner at Uchi was great, I got this one ($86)" },
        { id: "m2", senderId: "p_me", senderName: "Me", time: "19:10", text: "thanks! I'll get lunch next time" },
      ],
    },
    { mode: "live" },
  );
  console.log("messageDay:", JSON.stringify(out, null, 2));
  const web = await generateGrounded(db, webCost, { venue: "Kayaking at Lady Bird Lake", eventType: "kayak rental" }, { mode: "live" });
  console.log("webCost:", JSON.stringify(web, null, 2));
  await flushTraces();
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
