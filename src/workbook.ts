/**
 * Workbook IO for the compliance log (xlsx or Google Sheet export).
 * Reads the "Consent & DNC Log" + "DNC Register" tabs and applies cleanse results.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");
import { Contact, CleanseResult } from "./cleanse.js";

const LOG_TAB = "Consent & DNC Log";
const DNC_TAB = "DNC Register";
/**
 * Read a cell as trimmed text. Returns undefined when the column is absent
 * or the cell is blank. Preserves meaningful falsy values such as "0".
 *
 * NOTE: the previous code used `row[idx] ? String(row[idx]) : undefined`,
 * which silently turned a cell containing "0" or "FALSE" into undefined,
 * and `String(row[idx] ?? i)`, which does NOT fall through on "" - so a
 * blank RowID produced "" and every blank-RowID row then matched any
 * other blank-RowID row, mass-flagging unrelated contacts as DNC.
 */
function cellText(row: any[], header: string[], name: string): string | undefined {
  const idx = header.indexOf(name);
  if (idx < 0) return undefined;
  const v = row[idx];
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/**
 * Resolve a required tab. Falls back only for READ-ONLY inspection
 * (SA_DM_ALLOW_FALLBACK=1); otherwise exits rather than risk mutating the
 * wrong sheet - sheet 0 may be the DNC Register itself.
 */
function requireTab(wb: any, tab: string, path: string, fallback: any): any {
  const ws = wb.Sheets[tab];
  if (ws) return ws;
  if (process.env.SA_DM_ALLOW_FALLBACK === "1") {
    console.warn(`WARN: tab "${tab}" not found; using a fallback tab. Read-only.`);
    return fallback;
  }
  console.error(`ERROR: tab "${tab}" not found in ${path}`);
  console.error(`Tabs present: ${Object.keys(wb.Sheets).join(", ")}`);
  console.error("Refusing to write. Create the tab, or set SA_DM_ALLOW_FALLBACK=1 for a read-only look.");
  process.exit(2);
}

export interface LogData {
  contacts: Contact[];
  logRows: any[][];
  logHeader: string[];
  dncRows: any[][];
  dncHeader: string[];
  wb: ReturnType<typeof XLSX.readFile>;
}

export function readLog(path: string): LogData {
  const wb = XLSX.readFile(path);
  const logWs = requireTab(wb, LOG_TAB, path, Object.values(wb.Sheets)[0]);
  const logRows = XLSX.utils.sheet_to_json(logWs, { header: 1, raw: false, defval: "" }) as any[][];
  const logHeader = logRows[0] ?? [];
  const dncWs = wb.Sheets[DNC_TAB];
  const dncRows = dncWs ? (XLSX.utils.sheet_to_json(dncWs, { header: 1, raw: false, defval: "" }) as any[][]) : [[ "Business Name", "Contact Person", "Channel", "Date Refused", "Notes" ]];
  const dncHeader = dncRows[0] ?? ["Business Name", "Contact Person", "Channel", "Date Refused", "Notes"];

  const contacts: Contact[] = [];
  for (let i = 1; i < logRows.length; i++) {
    const row = logRows[i];
    if (!row || row.every((c: any) => c === "")) continue;
    contacts.push({
      rowId: cellText(row, logHeader, "RowID") ?? String(i),
      business: String(row[logHeader.indexOf("Business Name")] ?? ""),
      contact: cellText(row, logHeader, "Contact Person"),
      email: cellText(row, logHeader, "Email"),
      phone: cellText(row, logHeader, "Phone"),
      channel: cellText(row, logHeader, "Primary Channel"),
      consentResponse: cellText(row, logHeader, "Consent Response"),
      dnc: cellText(row, logHeader, "DNC (Y/N)"),
      notes: cellText(row, logHeader, "Notes"),
    });
  }
  return { contacts, logRows, logHeader, dncRows, dncHeader, wb };
}

/**
 * Apply a cleanse result: append matched contacts to the DNC Register and flip
 * their DNC flag in the log. Returns the mutated workbook (caller writes it).
 */
export function applyCleanse(data: LogData, result: CleanseResult): ReturnType<typeof XLSX.readFile> {
  const { logHeader, dncHeader, logRows } = data;
  const dncCol = {
    business: dncHeader.indexOf("Business Name"),
    contact: dncHeader.indexOf("Contact Person"),
    channel: dncHeader.indexOf("Channel"),
    date: dncHeader.indexOf("Date Refused"),
    notes: dncHeader.indexOf("Notes"),
  };
  const logDncCol = logHeader.indexOf("DNC (Y/N)");
  const logNotesCol = logHeader.indexOf("Notes");
  const today = new Date().toISOString().slice(0, 10);

  const matchedIds = new Set(result.matched.map((m) => m.rowId));
  // flip DNC in log
  for (let i = 1; i < logRows.length; i++) {
    const rid = cellText(logRows[i], logHeader, "RowID") ?? String(i);
    if (matchedIds.has(rid)) {
      if (logDncCol >= 0) logRows[i][logDncCol] = "YES";
      if (logNotesCol >= 0) logRows[i][logNotesCol] = (logRows[i][logNotesCol] ? logRows[i][logNotesCol] + "; " : "") + "DNC: NCC opt-out registry " + today;
    }
  }
  // append to DNC register
  const dncOut = [...data.dncRows];
  for (const m of result.matched) {
    const row: any[] = new Array(dncHeader.length).fill("");
    if (dncCol.business >= 0) row[dncCol.business] = m.business;
    if (dncCol.contact >= 0) row[dncCol.contact] = m.contact ?? "";
    if (dncCol.channel >= 0) row[dncCol.channel] = m.channel ?? "";
    if (dncCol.date >= 0) row[dncCol.date] = today;
    if (dncCol.notes >= 0) row[dncCol.notes] = "NCC opt-out registry monthly cleanse " + today + (m.notes ? " — " + m.notes : "");
    dncOut.push(row);
  }

  const wb = data.wb;
  wb.Sheets[LOG_TAB] = XLSX.utils.aoa_to_sheet(logRows);
  // SheetJS writes ONLY the tabs listed in wb.SheetNames. Assigning wb.Sheets
  // alone silently DROPS the DNC Register: the log would show a suppression
  // with no register entry surviving. Register the name too.
  if (!wb.SheetNames.includes(DNC_TAB)) wb.SheetNames.push(DNC_TAB);
  wb.Sheets[DNC_TAB] = XLSX.utils.aoa_to_sheet(dncOut);
  return wb;
}

export { LOG_TAB, DNC_TAB };

/**
 * Read the MASTER LEADS workbook (KZN_Plumbers_Master.xlsx style).
 * Columns: Business Name, Phone Number, Email, Contact Person, ... + optional DNC.
 * Adds a "DNC (Y/N)" column if absent so we can flag matches.
 */
export function readLeads(path: string, leadTab = "All KZN Plumbers"): LogData {
  const wb = XLSX.readFile(path);
  const leadWs = requireTab(wb, leadTab, path, Object.values(wb.Sheets)[0]);
  const leadRows = XLSX.utils.sheet_to_json(leadWs, { header: 1, raw: false, defval: "" }) as any[][];
  let leadHeader = leadRows[0] ?? [];
  // ensure DNC column exists
  let dncIdx = leadHeader.indexOf("DNC (Y/N)");
  if (dncIdx < 0) {
    dncIdx = leadHeader.length;
    leadHeader = [...leadHeader, "DNC (Y/N)"];
    leadRows[0] = leadHeader;
  }
  const contacts: Contact[] = [];
  for (let i = 1; i < leadRows.length; i++) {
    const row = leadRows[i];
    if (!row || row.every((c: any) => c === "")) continue;
    const get = (name: string) => {
      const idx = leadHeader.indexOf(name);
      return idx >= 0 && idx < row.length ? String(row[idx] ?? "") : "";
    };
    contacts.push({
      rowId: String(i),
      business: get("Business Name"),
      contact: get("Contact Person") || undefined,
      email: get("Email") || undefined,
      phone: get("Phone Number") || undefined,
      channel: undefined,
      consentResponse: "",
      dnc: get("DNC (Y/N)") || undefined,
      notes: get("Notes") || undefined,
    });
  }
  // DNC register kept in the same workbook on a dedicated tab
  const dncWs = wb.Sheets[DNC_TAB];
  const dncRows = dncWs ? (XLSX.utils.sheet_to_json(dncWs, { header: 1, raw: false, defval: "" }) as any[][]) : [[ "Business Name", "Contact Person", "Channel", "Date Refused", "Notes" ]];
  const dncHeader = dncRows[0] ?? ["Business Name", "Contact Person", "Channel", "Date Refused", "Notes"];
  return { contacts, logRows: leadRows, logHeader: leadHeader, dncRows, dncHeader, wb };
}

/** Apply cleanse to a leads workbook: flip DNC in the leads tab + append register. */
export function applyLeadsCleanse(data: LogData, result: CleanseResult, leadTab = "All KZN Plumbers"): ReturnType<typeof XLSX.readFile> {
  const { logHeader, dncHeader, logRows } = data;
  const dncCol = {
    business: dncHeader.indexOf("Business Name"),
    contact: dncHeader.indexOf("Contact Person"),
    channel: dncHeader.indexOf("Channel"),
    date: dncHeader.indexOf("Date Refused"),
    notes: dncHeader.indexOf("Notes"),
  };
  const logDncCol = logHeader.indexOf("DNC (Y/N)");
  const today = new Date().toISOString().slice(0, 10);
  const matchedIds = new Set(result.matched.map((m) => m.rowId));
  for (let i = 1; i < logRows.length; i++) {
    const rid = String(i);
    if (matchedIds.has(rid) && logDncCol >= 0) {
      logRows[i][logDncCol] = "YES";
    }
  }
  const dncOut = [...data.dncRows];
  for (const m of result.matched) {
    const row: any[] = new Array(dncHeader.length).fill("");
    if (dncCol.business >= 0) row[dncCol.business] = m.business;
    if (dncCol.contact >= 0) row[dncCol.contact] = m.contact ?? "";
    if (dncCol.channel >= 0) row[dncCol.channel] = m.channel ?? "leads";
    if (dncCol.date >= 0) row[dncCol.date] = today;
    if (dncCol.notes >= 0) row[dncCol.notes] = "NCC opt-out registry monthly cleanse " + today + (m.notes ? " — " + m.notes : "");
    dncOut.push(row);
  }
  const wb = data.wb;
  wb.Sheets[leadTab] = XLSX.utils.aoa_to_sheet(logRows);
  if (!wb.SheetNames.includes(leadTab)) wb.SheetNames.push(leadTab);
  wb.Sheets[DNC_TAB] = XLSX.utils.aoa_to_sheet(dncOut);
  // SheetJS writes ONLY the tabs listed in wb.SheetNames. Assigning wb.Sheets
  // alone silently DROPS the DNC Register: the log would show a suppression
  // with no register entry surviving. Register the name too.
  if (!wb.SheetNames.includes(DNC_TAB)) wb.SheetNames.push(DNC_TAB);
  return wb;
}


