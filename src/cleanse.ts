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
  /** Already suppressed before this run - not re-checked, NOT safe to market. */
  alreadyDnc: Contact[];
  blocklistSize: number;
  generatedAt: string;
}

/**
 * Normalize a SA phone to local form: 0XX XXX XXXX.
 * Handles +27, 27, 0027 and 00 international prefixes.
 *
 * The "00" prefix matters: a registry export containing "0027821234567"
 * would previously fail to match a list entry of "0821234567" - a SILENT
 * MISS, meaning a consumer who blocked us stays live on the list.
 * The "27" branch also had a defect: it built "0" + the full number
 * instead of dropping the prefix, producing "027821234567".
 */
export function normalizePhone(p: string): string {
  let s = (p || "").replace(/[\s\-().]/g, "");
  if (s.startsWith("+27")) s = "0" + s.slice(3);
  if (s.startsWith("0027")) s = "0" + s.slice(4);
  if (s.startsWith("27") && s.length === 11) s = "0" + s.slice(2);
  return s.replace(/[^0-9]/g, "");
}

/**
 * Is this a matchable SA MOBILE number?
 *
 * The NCC opt-out registry targets mobile numbers, so landlines must be
 * rejected - otherwise "011 123 4567" is treated as a consumer and written
 * into the DNC register as a false suppression. 07x and 08x are SA mobiles.
 */
export function isMobileNumber(n: string): boolean {
  return /^0[78]\d{8}$/.test(n);
}

export function normalizeEmail(e: string): string {
  return (e || "").trim().toLowerCase();
}

/** Extract all matchable identifiers (phone + email) from a contact. */
export function contactIdentifiers(c: Contact): string[] {
  const ids = new Set<string>();
  if (c.phone) {
    const n = normalizePhone(c.phone);
    if (isMobileNumber(n)) ids.add(n);
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
      if (isMobileNumber(n)) ids.add(n);
    }
  }
  return [...ids];
}

/** Parse a blocklist CSV (columns: phone and/or email; flexible headers). */
export function parseBlocklist(rows: Record<string, string>[]): BlocklistEntry[] {
  const out: BlocklistEntry[] = [];
  for (const r of rows) {
    const keys = Object.keys(r);
    // Score every header so an exact "Email" beats an incidental "Mailer".
    const phoneKey = keys
      .map((k) => ({ k, s: /^(phone|cell|mobile)(\s*(number|no\.?))?$/i.test(k) ? 3 : /phone|cell|mobile/i.test(k) ? 2 : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)[0]?.k;
    const emailKey = keys
      .map((k) => ({ k, s: /^(e-?mail|email address)$/i.test(k) ? 3 : /e-?mail/i.test(k) ? 2 : /\bmail\b/i.test(k) ? 1 : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)[0]?.k;
    if (phoneKey && r[phoneKey]) {
      const n = normalizePhone(r[phoneKey]);
      if (isMobileNumber(n)) out.push({ identifier: n, raw: r[phoneKey], kind: "phone" });
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
  const alreadyDnc: Contact[] = [];
  let checked = 0;
  for (const c of contacts) {
    if (!isActive(c)) {
      alreadyDnc.push(c);
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
    alreadyDnc,
    blocklistSize: blocklist.length,
    generatedAt: new Date().toISOString(),
  };
}

