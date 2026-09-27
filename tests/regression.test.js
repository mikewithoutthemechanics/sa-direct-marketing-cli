/**
 * BUG-1 regression + core cleanse tests. Built dist/ is imported (npm run build first).
 * Run: npm run build, then node --test on this file
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

import { cleanse, normalizePhone, isActive, parseBlocklist, contactIdentifiers } from "../dist/cleanse.js";
import { readLog, applyCleanse, readLeads, applyLeadsCleanse } from "../dist/workbook.js";

function tmpXlsx(tabs) {
  const dir = mkdtempSync(join(tmpdir(), "sadm-"));
  const wb = XLSX.utils.book_new();
  for (const [name, data] of Object.entries(tabs)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
  }
  const p = join(dir, "t.xlsx");
  XLSX.writeFile(wb, p);
  return p;
}
const LOG_TAB = "Consent & DNC Log";
const LOG_HEADER = ["RowID", "Business Name", "Contact Person", "Email", "Phone", "DNC (Y/N)"];
const BL = (n) => [{ identifier: n, raw: n, kind: "phone" }];

// ------------------------------------------------------------------ BUG-1
test("BUG-1: blank RowID must not mass-match every blank row", () => {
  const path = tmpXlsx({ [LOG_TAB]: [
    LOG_HEADER,
    ["", "Alpha Plumbing", "Ann", "", "0821111111", "N"],
    ["", "Bravo Solar",   "Ben", "", "0822222222", "N"],
    ["", "Charlie Co",    "Cal", "", "0823333333", "N"],
  ]});
  const data = readLog(path);
  const r = cleanse(data.contacts, BL("0822222222"));
  assert.equal(
    r.matched.length, 1,
    "expected 1 match (Bravo only), got " + r.matched.length + ": " +
      r.matched.map((m) => m.business).join(", ")
  );
  assert.equal(r.matched[0].business, "Bravo Solar");
});

test("BUG-1: applyCleanse flips ONLY the matched blank-RowID row", () => {
  const path = tmpXlsx({ [LOG_TAB]: [
    LOG_HEADER,
    ["", "Alpha Plumbing", "Ann", "", "0821111111", "N"],
    ["", "Bravo Solar",   "Ben", "", "0822222222", "N"],
    ["", "Charlie Co",    "Cal", "", "0823333333", "N"],
  ]});
  const data = readLog(path);
  applyCleanse(data, cleanse(data.contacts, BL("0822222222")));
  assert.equal(data.logRows[2][5], "YES", "Bravo -> DNC");
  assert.notEqual(data.logRows[1][5], "YES", "Alpha must stay N");
  assert.notEqual(data.logRows[3][5], "YES", "Charlie must stay N");
});

test("BUG-1: distinct populated RowIDs each match only their own row", () => {
  const path = tmpXlsx({ [LOG_TAB]: [
    LOG_HEADER,
    ["R1", "Alpha", "Ann", "", "0821111111", "N"],
    ["R2", "Bravo", "Ben", "", "0822222222", "N"],
    ["R3", "Charlie","Cal", "", "0823333333", "N"],
  ]});
  const data = readLog(path);
  const r = cleanse(data.contacts, BL("0822222222"));
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].rowId, "R2");
  applyCleanse(data, r);
  assert.equal(data.logRows[2][5], "YES");
  assert.equal(data.logRows[1][5], "N");
  assert.equal(data.logRows[3][5], "N");
});

// ----------------------------------------------------------------- BUG-10
test('BUG-10: falsy cell values ("0", "FALSE") are preserved', () => {
  const path = tmpXlsx({ [LOG_TAB]: [
    LOG_HEADER,
    ["R1", "Zero Co", "0", "", "0821111111", "N"],
  ]});
  const data = readLog(path);
  assert.equal(data.contacts[0].contact, "0", 'cell "0" must survive');
});

// --------------------------------------------------------------- normalize
test("normalizePhone handles SA formats incl. 00 international prefix", () => {
  assert.equal(normalizePhone("0821234567"), "0821234567");
  assert.equal(normalizePhone("+27821234567"), "0821234567");
  assert.equal(normalizePhone("27821234567"), "0821234567");
  assert.equal(normalizePhone("0027821234567"), "0821234567", "00 prefix");
  assert.equal(normalizePhone("(082) 123-4567"), "0821234567");
  assert.equal(normalizePhone("082 123 4567"), "0821234567");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone("abc"), "");
});

test("BUG-6/7: 00-prefixed number matches its local form (silent-miss bug)", () => {
  const path = tmpXlsx({ [LOG_TAB]: [
    LOG_HEADER,
    ["R1", "Bravo", "Ben", "", "0027821234567", "N"],
  ]});
  const data = readLog(path);
  const r = cleanse(data.contacts, BL("0821234567"));
  assert.equal(r.matched.length, 1, "00278... must match 082...");
});

// --------------------------------------------------------------- isActive
test("isActive honours Y/YES/y/yes as suppressed; N/empty as active", () => {
  assert.equal(isActive({ rowId: "1", business: "x", dnc: "Y" }), false);
  assert.equal(isActive({ rowId: "1", business: "x", dnc: "YES" }), false);
  assert.equal(isActive({ rowId: "1", business: "x", dnc: "y" }), false);
  assert.equal(isActive({ rowId: "1", business: "x", dnc: "yes" }), false);
  assert.equal(isActive({ rowId: "1", business: "x", dnc: "N" }), true);
  assert.equal(isActive({ rowId: "1", business: "x", dnc: "" }), true);
  assert.equal(isActive({ rowId: "1", business: "x" }), true);
});

test("already-DNC contacts are not re-checked", () => {
  const c = { rowId: "1", business: "Bravo", phone: "0822222222", dnc: "YES" };
  const r = cleanse([c], BL("0822222222"));
  assert.equal(r.matched.length, 0, "suppressed contact must not re-match");
  assert.equal(r.checked, 0);
});

// --------------------------------------------------------- parseBlocklist
test("parseBlocklist reads phone, email and both", () => {
  const bl = parseBlocklist([
    { Phone: "0821234567" },
    { Email: "A@B.CO" },
    { Cell: "+27821234567", "E-mail": "c@d.co" },
  ]);
  const ids = bl.map((b) => b.identifier);
  assert.ok(ids.includes("0821234567"));
  assert.ok(ids.includes("a@b.co"));
  assert.ok(ids.includes("c@d.co"));
});

test("parseBlocklist prefers Email over a 'Mailer' column (BUG-8)", () => {
  const bl = parseBlocklist([{ Mailer: "nope", Email: "real@example.com" }]);
  assert.ok(bl.some((b) => b.identifier === "real@example.com"),
    "should read the Email column, not Mailer");
});

test("parseBlocklist skips junk rows", () => {
  assert.deepEqual(parseBlocklist([{ Phone: "" }, { Phone: "123" }]), []);
});

// ------------------------------------------------- contactIdentifiers
test("contactIdentifiers collects phone, email and free-text contact", () => {
  const ids = contactIdentifiers({
    rowId: "1", business: "x", phone: "0821234567",
    email: "A@b.co", contact: "0827654321",
  });
  assert.ok(ids.includes("0821234567"));
  assert.ok(ids.includes("a@b.co"));
  assert.ok(ids.includes("0827654321"));
});

test("contact with no matchable identifiers is safely unmatched", () => {
  const r = cleanse([{ rowId: "1", business: "NoContact" }], BL("0821234567"));
  assert.equal(r.matched.length, 0);
  assert.equal(r.checked, 1);
});

// ---------------------------------------------------------- leads schema
test("leads schema matches on 'Phone Number' and is immune to BUG-1", () => {
  const path = tmpXlsx({ "All KZN Plumbers": [
    ["Business Name", "Phone Number", "Email"],
    ["Alpha", "0821111111", "a@a.co"],
    ["Bravo", "0822222222", "b@b.co"],
  ]});
  const data = readLeads(path, "All KZN Plumbers");
  const r = cleanse(data.contacts, BL("0822222222"));
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].business, "Bravo");
});

test("blocklist size and generatedAt are reported", () => {
  const r = cleanse([], BL("0821234567"));
  assert.equal(r.blocklistSize, 1);
  assert.ok(!Number.isNaN(Date.parse(r.generatedAt)));
});


// ------------------------------------------ DATA LOSS: DNC Register dropped
test("DATA LOSS: DNC Register tab must survive a real write to disk", () => {
  const path = tmpXlsx({ [LOG_TAB]: [
    LOG_HEADER,
    ["", "Alpha Plumbing", "Ann", "", "0821111111", "N"],
    ["", "Bravo Solar",   "Ben", "", "0822222222", "N"],
  ]});
  const data = readLog(path);
  const r = cleanse(data.contacts, BL("0822222222"));
  assert.equal(r.matched.length, 1);
  const wb = applyCleanse(data, r);
  XLSX.writeFile(wb, path);

  // re-read from disk: the register must exist AND contain Bravo
  const wb2 = XLSX.readFile(path);
  assert.ok(wb2.SheetNames.includes("DNC Register"),
    "DNC Register missing after write; SheetNames not updated");
  const reg = XLSX.utils.sheet_to_json(wb2.Sheets["DNC Register"], { header: 1, defval: "" });
  assert.equal(reg.length, 2, "expected header + 1 suppression, got " + reg.length);
  assert.equal(reg[1][0], "Bravo Solar", "register must name the suppressed business");
  assert.match(String(reg[1][3]), /^\d{4}-\d{2}-\d{2}$/, "register needs a date refused");
});

test("DATA LOSS: leads schema must also persist the DNC Register", () => {
  const path = tmpXlsx({ "All KZN Plumbers": [
    ["Business Name", "Phone Number", "Email"],
    ["Alpha", "0821111111", "a@a.co"],
    ["Bravo", "0822222222", "b@b.co"],
  ]});
  const data = readLeads(path, "All KZN Plumbers");
  const r = cleanse(data.contacts, BL("0822222222"));
  const wb = applyLeadsCleanse(data, r, "All KZN Plumbers");
  XLSX.writeFile(wb, path);
  const wb2 = XLSX.readFile(path);
  assert.ok(wb2.SheetNames.includes("DNC Register"), "register missing for leads schema");
  assert.ok(wb2.SheetNames.includes("All KZN Plumbers"), "leads tab lost");
});

test("DATA LOSS: an existing DNC Register must keep its prior rows", () => {
  const path = tmpXlsx({
    [LOG_TAB]: [LOG_HEADER, ["R1", "Bravo", "Ben", "", "0822222222", "N"]],
    "DNC Register": [["Business Name", "Contact Person", "Channel", "Date Refused", "Notes"],
                     ["Older Co", "Zoe", "sms", "2026-01-01", "previous suppression"]],
  });
  const data = readLog(path);
  const r = cleanse(data.contacts, BL("0822222222"));
  XLSX.writeFile(applyCleanse(data, r), path);
  const reg = XLSX.utils.sheet_to_json(XLSX.readFile(path).Sheets["DNC Register"], { header: 1, defval: "" });
  assert.equal(reg.length, 3, "header + 1 old + 1 new expected, got " + reg.length);
  assert.equal(reg[1][0], "Older Co", "prior register row must be preserved");
  assert.equal(reg[2][0], "Bravo");
});



// ------------------------------------------------- C-04 input guards
test("C-04: an oversized workbook is refused, not parsed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sadm-big-"));
  const p = join(dir, "big.xlsx");
  const fh = require("node:fs").createWriteStream ? null : null;
  const { writeFileSync } = require("node:fs");
  // a sparse 30MB file: exceeds the 25MB default guard
  writeFileSync(p, Buffer.alloc(30 * 1024 * 1024, 0));
  const prev = process.env.SA_DM_MAX_BYTES;
  delete process.env.SA_DM_MAX_BYTES;
  const realExit = process.exit;
  let code = null;
  process.exit = (c) => { code = c; throw new Error("__exit__" + c); };
  try {
    readLog(p);
  } catch (e) {
    if (!String(e.message).startsWith("__exit__")) throw e;
  } finally {
    process.exit = realExit;
    if (prev !== undefined) process.env.SA_DM_MAX_BYTES = prev;
  }
  assert.equal(code, 2, "oversized workbook must be refused with exit 2");
});

test("C-04: guard limit is overridable via SA_DM_MAX_BYTES", () => {
  const dir = mkdtempSync(join(tmpdir(), "sadm-ok-"));
  const p = join(dir, "small.xlsx");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([LOG_HEADER, ["R1", "A", "Ann", "", "0821111111", "N"]]), LOG_TAB);
  XLSX.writeFile(wb, p);
  // allow 1GB - must parse fine
  process.env.SA_DM_MAX_BYTES = String(1024 * 1024 * 1024);
  try {
    const d = readLog(p);
    assert.equal(d.contacts.length, 1, "small workbook must still load");
  } finally {
    delete process.env.SA_DM_MAX_BYTES;
  }
});