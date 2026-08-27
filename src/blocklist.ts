import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { BlocklistEntry, parseBlocklist } from "./cleanse.js";

/** Read an NCC registry export CSV into BlocklistEntry[]. */
export function readBlocklistCsv(path: string): BlocklistEntry[] {
  const content = readFileSync(path, "utf8");
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  if (records.length === 0) return [];
  return parseBlocklist(records);
}
