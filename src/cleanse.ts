/**
 * Core cleanse logic for SA direct-marketing compliance.
 *
 * POPIA s69 + CPA Amendment Regulations 2026: the NCC opt-out registry
 * (https://eservice.thencc.org.za/) is LIVE and mandates MONTHLY cleansing of
 * marketing databases against the registry. The registry has NO public API — it
 * is a web portal. So the compliant workflow is:
 *   1. Export the blocked consumers from the NCC portal (CSV) -> blocklist.
 *   2. Run this cleanse: cross-reference your active marketing list against the
 *      blocklist by phone/email; any match is removed (DNC).
 *
 * This module is pure: it reads a workbook + a blocklist, returns the matches.
 * IO (writing the DNC register, flipping the log) is done by the callers so the
 * same logic can run from CLI, MCP, or tests.
 */

export interface Contact {
  rowId: string;
  business: string;
  contact?: string;
  email?: string;
  phone?: string;
  channel?: string;
  consentResponse?: string;
  dnc?: string; // "Y" | "N" | ""
  notes?: string;
}

export interface BlocklistEntry {
  identifier: string; // normalized phone OR email
  raw: string;
  kind: "phone" | "email";
}

export interface CleanseResult {
  checked: number;
  matched: Contact[];
  unmatched: Contact[];
  blocklistSize: number;
  generatedAt: string;
}

/** Normalize a phone: strip spaces, leading +27 -> 0, keep digits. */
export function normalizePhone(p: string): string {
  let s = (p || "").replace(/[\s\-()]/g, "");
  if (s.startsWith("+27")) s = "0" + s.slice(3);
  if (s.startsWith("27") && s.length === 11) s = "0" + s;
  return s.replace(/[^0-9]/g, "");
}

export function normalizeEmail(e: string): string {
  return (e || "").trim().toLowerCase();
}

/** Extract all matchable identifiers (phone + email) from a contact. */
export function contactIdentifiers(c: Contact): string[] {
  const ids = new Set<string>();
  if (c.phone) {
    const n = normalizePhone(c.phone);
    if (n.length >= 9) ids.add(n);
  }
  if (c.email) {
    const n = normalizeEmail(c.email);
    if (n.includes("@")) ids.add(n);
  }
  // also catch a free-text "contact" field that may hold either
  if (c.contact) {
    if (c.contact.includes("@")) {
      const n = normalizeEmail(c.contact);
      if (n.includes("@")) ids.add(n);
    } else {
      const n = normalizePhone(c.contact);
      if (n.length >= 9) ids.add(n);
    }
  }
  return [...ids];
}

/** Parse a blocklist CSV (columns: phone and/or email; flexible headers). */
export function parseBlocklist(rows: Record<string, string>[]): BlocklistEntry[] {
  const out: BlocklistEntry[] = [];
  for (const r of rows) {
    const keys = Object.keys(r);
    const phoneKey = keys.find((k) => /phone|cell|mobile|number/i.test(k));
    const emailKey = keys.find((k) => /email|e-mail|mail/i.test(k));
    if (phoneKey && r[phoneKey]) {
      const n = normalizePhone(r[phoneKey]);
      if (n.length >= 9) out.push({ identifier: n, raw: r[phoneKey], kind: "phone" });
    }
    if (emailKey && r[emailKey]) {
      const n = normalizeEmail(r[emailKey]);
      if (n.includes("@")) out.push({ identifier: n, raw: r[emailKey], kind: "email" });
    }
  }
  return out;
}

/** Contacts are "active" (subject to cleanse) if they are NOT already DNC'd. */
export function isActive(c: Contact): boolean {
  const dnc = (c.dnc || "").toUpperCase();
  return !(dnc === "Y" || dnc === "YES");
}

/**
 * Run the cleanse. Returns matched (to be DNC'd) + unmatched (stay).
 * `blocklist` is a Set of normalized identifiers for O(1) lookup.
 */
export function cleanse(contacts: Contact[], blocklist: BlocklistEntry[]): CleanseResult {
  const blSet = new Set(blocklist.map((b) => b.identifier));
  const matched: Contact[] = [];
  const unmatched: Contact[] = [];
  let checked = 0;
  for (const c of contacts) {
    if (!isActive(c)) {
      unmatched.push(c);
      continue;
    }
    checked++;
    const ids = contactIdentifiers(c);
    const hit = ids.find((id) => blSet.has(id));
    if (hit) matched.push({ ...c, notes: `NCC opt-out registry match (${hit})` });
    else unmatched.push(c);
  }
  return {
    checked,
    matched,
    unmatched,
    blocklistSize: blocklist.length,
    generatedAt: new Date().toISOString(),
  };
}
