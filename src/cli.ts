#!/usr/bin/env node
/**
 * sa-dm — SA direct-marketing compliance CLI.
 *
 *   sa-dm cleanse --log compliance.xlsx --blocklist ncc-export.csv [--write]
 *
 * Cross-references your active marketing list (compliance log) against an NCC
 * opt-out registry export. With --write it flips matched rows to DNC and appends
 * to the DNC Register; without --write it is a dry run (reports matches only).
 */
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { readLog, applyCleanse, readLeads, applyLeadsCleanse } from "./workbook.js";
import { readBlocklistCsv } from "./blocklist.js";
import { cleanse } from "./cleanse.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const argv = yargs(hideBin(process.argv))
  .command(
    "cleanse",
    "Cleanse a compliance log or leads list against an NCC opt-out registry blocklist export",
    (y) =>
      y
        .option("log", { type: "string", demandOption: true, describe: "Path to compliance log .xlsx OR master leads .xlsx" })
        .option("blocklist", { type: "string", demandOption: true, describe: "Path to NCC registry export .csv" })
        .option("type", { type: "string", choices: ["log", "leads"], default: "log", describe: "Workbook schema: 'log' (Consent & DNC Log) or 'leads' (master plumbers list)" })
        .option("tab", { type: "string", default: "All KZN Plumbers", describe: "Leads tab name when --type leads (e.g. 'All WC Leads')" })
        .option("write", { type: "boolean", default: false, describe: "Actually apply DNC changes (default: dry run)" })
        .option("out", { type: "string", describe: "Output path when --write (defaults to overwriting --log)" }),
    (args) => {
      const data = args.type === "leads" ? readLeads(args.log, args.tab) : readLog(args.log);
      const blocklist = readBlocklistCsv(args.blocklist);
      if (blocklist.length === 0) {
        console.error("⚠ No blocklist entries loaded. Did you export from https://eservice.thencc.org.za/ ?");
        process.exit(2);
      }
      const result = cleanse(data.contacts, blocklist);
      console.log(`Mode                    : ${args.type}${args.type === "leads" ? " (tab: " + args.tab + ")" : ""}`);
      console.log(`Checked active contacts : ${result.checked}`);
      console.log(`Already DNC (skipped)   : ${result.alreadyDnc.length}`);
      console.log(`Blocklist size          : ${result.blocklistSize}`);
      console.log(`Matched (-> DNC)         : ${result.matched.length}`);
      for (const m of result.matched) {
        console.log(`   • ${m.business}${m.contact ? " (" + m.contact + ")" : ""} — ${m.notes}`);
      }
      if (result.matched.length === 0) {
        console.log("✓ No registry matches. List is clean for this month.");
      }
      // Always write when --write is set (ensures DNC column exists even with 0 matches)
      if (args.write) {
        const wb = args.type === "leads" ? applyLeadsCleanse(data, result, args.tab) : applyCleanse(data, result);
        const out = args.out ?? args.log;
        XLSX.writeFile(wb, out);
        const verb = result.matched.length > 0 ? "Wrote DNC updates" : "Wrote (no matches; DNC column ensured)";
        console.log(`✓ ${verb} to ${out}`);
      } else {
        console.log("(dry run — re-run with --write to apply DNC changes)");
      }
    }
  )
  .demandCommand(1)
  .help().argv;
