// The user's contacts: the identity source for ingest (persons + aliases). Read from people.json.
import type { AliasKind } from "@sark/shared";
import fs from "node:fs/promises";

export interface PersonSeed {
  id: string;
  displayName: string;
  isUser: boolean;
  aliases: { kind: AliasKind; value: string }[];
}

export interface PeopleSource {
  listPeople(): Promise<PersonSeed[]>;
}

export async function loadPeople(file: string): Promise<PersonSeed[]> {
  return JSON.parse(await fs.readFile(file, "utf8")) as PersonSeed[];
}

export class FilePeopleSource implements PeopleSource {
  constructor(private file: string) {}
  listPeople() {
    return loadPeople(this.file);
  }
}
