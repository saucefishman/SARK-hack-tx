// Instagram "Download your information" export reader (messages/inbox/<thread>/message_*.json).
import fs from "node:fs/promises";
import path from "node:path";
import type { MessageSource, RawMessage } from "./types";

/**
 * Instagram exports UTF-8 text as if each byte were a latin-1 char ("café" -> "cafÃ©").
 * Reinterpret as latin-1 bytes then decode UTF-8; strings that are not mojibake are returned unchanged.
 */
export function fixMojibake(s: string): string {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return s; // already real unicode
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(s, "latin1"));
  } catch {
    return s;
  }
}

interface IgFile {
  participants?: { name: string }[];
  messages?: { sender_name: string; timestamp_ms: number; content?: string }[];
  title?: string;
}

const numericSuffix = (f: string) => Number(/message_(\d+)\.json$/.exec(f)?.[1] ?? 0);

export class InstagramMessageSource implements MessageSource {
  /** @param dir folder containing `messages/inbox/` (MESSAGES_DIR) */
  constructor(private dir: string) {}

  async *listMessages(): AsyncIterable<RawMessage> {
    const inbox = path.join(this.dir, "messages", "inbox");
    const threads = (await fs.readdir(inbox, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const all: RawMessage[] = [];
    for (const threadId of threads) {
      const files = (await fs.readdir(path.join(inbox, threadId)))
        .filter((f) => /^message_\d+\.json$/.test(f))
        .sort((a, b) => numericSuffix(a) - numericSuffix(b));
      let index = 0;
      for (const f of files) {
        const j = JSON.parse(await fs.readFile(path.join(inbox, threadId, f), "utf8")) as IgFile;
        const participants = (j.participants ?? []).map((p) => fixMojibake(p.name));
        const title = fixMojibake(j.title ?? threadId);
        for (const m of j.messages ?? []) {
          if (typeof m.content !== "string") continue; // reactions, media-only
          all.push({
            id: `${threadId}:${m.timestamp_ms}:${index++}`,
            threadId,
            threadTitle: title,
            participants,
            senderName: fixMojibake(m.sender_name),
            timestampMs: m.timestamp_ms,
            content: fixMojibake(m.content),
          });
        }
      }
    }
    all.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
    yield* all;
  }
}
