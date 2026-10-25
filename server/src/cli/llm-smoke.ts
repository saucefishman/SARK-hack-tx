// Live smoke test: one tiny messageDay call. Needs GEMINI_API_KEY (human task H3).
import { getConfig } from "../config";
import { createDb } from "../db/pool";
import { migrate } from "../db/migrate";
import { generateStructured, messageDay } from "../llm";

async function main() {
  if (!getConfig({ LLM_MODE: "replay" }).GEMINI_API_KEY) {
    console.log("H3 needed");
    return;
  }
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
  console.log(JSON.stringify(out, null, 2));
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
