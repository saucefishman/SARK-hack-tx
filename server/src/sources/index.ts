// Builds the default (file/API) sources from config for ingest.
import path from "node:path";
import type { Config } from "../config";
import type { IngestSources } from "../pipeline/ingest";
import { FileCalendarSource } from "./calendar";
import { InstagramMessageSource } from "./instagram";
import { NessieFileSource, NessieHttpClient } from "./nessie";
import { FilePeopleSource } from "./people";

export function defaultSources(config: Config): IngestSources {
  const calendarFile = config.resolvePath(config.CALENDAR_FILE);
  if (config.NESSIE_SOURCE === "api" && !config.NESSIE_API_KEY) {
    throw new Error("NESSIE_SOURCE=api requires NESSIE_API_KEY (human task H2)");
  }
  return {
    people: new FilePeopleSource(path.join(path.dirname(calendarFile), "people.json")),
    messages: new InstagramMessageSource(config.resolvePath(config.MESSAGES_DIR)),
    calendar: new FileCalendarSource(calendarFile),
    nessie:
      config.NESSIE_SOURCE === "api"
        ? new NessieHttpClient(config.NESSIE_BASE_URL, config.NESSIE_API_KEY!)
        : new NessieFileSource(config.resolvePath(config.NESSIE_FILE)),
  };
}
