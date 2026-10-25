import fs from "node:fs/promises";
import type { CalendarSource, RawCalendarEvent } from "./types";

/** Reads Google-Calendar-shaped events from a JSON array file (seed/generated/calendar.json). */
export class FileCalendarSource implements CalendarSource {
  constructor(private file: string) {}
  async listEvents(): Promise<RawCalendarEvent[]> {
    return JSON.parse(await fs.readFile(this.file, "utf8")) as RawCalendarEvent[];
  }
}
