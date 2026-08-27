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
  const logWs = wb.Sheets[LOG_TAB] ?? Object.values(wb.Sheets)[0];
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
      rowId: String(row[logHeader.indexOf("RowID")] ?? i),
      business: String(row[logHeader.indexOf("Business Name")] ?? ""),
      contact: row[logHeader.indexOf("Contact Person")] ? String(row[logHeader.indexOf("Contact Person")]) : undefined,
      email: row[logHeader.indexOf("Email")] ? String(row[logHeader.indexOf("Email")]) : undefined,
      phone: row[logHeader.indexOf("Phone")] ? String(row[logHeader.indexOf("Phone")]) : undefined,
      channel: row[logHeader.indexOf("Primary Channel")] ? String(row[logHeader.indexOf("Primary Channel")]) : undefined,
      consentResponse: row[logHeader.indexOf("Consent Response")] ? String(row[logHeader.indexOf("Consent Response")]) : undefined,
      dnc: row[logHeader.indexOf("DNC (Y/N)")] ? String(row[logHeader.indexOf("DNC (Y/N)")]) : undefined,
      notes: row[logHeader.indexOf("Notes")] ? String(row[logHeader.indexOf("Notes")]) : undefined,
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
    const rid = String(logRows[i][logHeader.indexOf("RowID")] ?? i);
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
  const leadWs = wb.Sheets[leadTab] ?? Object.values(wb.Sheets)[0];
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
  wb.Sheets[DNC_TAB] = XLSX.utils.aoa_to_sheet(dncOut);
  return wb;
}

