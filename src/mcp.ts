/**
 * MCP server (stdio) for SA direct-marketing compliance.
 * Exposes the NCC opt-out registry monthly cleanse as a tool so Hermes / cron
 * can invoke it natively.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readLog, applyCleanse, readLeads, applyLeadsCleanse } from "./workbook.js";
import { readBlocklistCsv } from "./blocklist.js";
import { cleanse } from "./cleanse.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const server = new Server(
  { name: "sa-direct-marketing", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "cleanse_marketing_list",
      description:
        "Cleanse a POPIA/CPA compliance log against an NCC opt-out registry blocklist export. " +
        "Cross-references active (opt-in) contacts by phone/email; matches are flagged DNC. " +
        "The NCC registry (eservice.thencc.org.za) has no API — the blocklist is a CSV you export from the portal.",
      inputSchema: {
        type: "object",
        properties: {
          logPath: { type: "string", description: "Path to compliance log .xlsx OR master leads .xlsx" },
          blocklistPath: { type: "string", description: "Path to NCC registry export .csv" },
          type: { type: "string", enum: ["log", "leads"], default: "log", description: "Workbook schema" },
          tab: { type: "string", description: "Leads tab name when type=leads (e.g. 'All WC Leads')", default: "All KZN Plumbers" },
          write: { type: "boolean", default: false, description: "Apply DNC changes (default false = dry run)" },
        },
        required: ["logPath", "blocklistPath"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "cleanse_marketing_list") {
    throw new Error("Unknown tool: " + req.params.name);
  }
  const { logPath, blocklistPath, type = "log", tab = "All KZN Plumbers", write = false } = req.params.arguments as any;
  const data = type === "leads" ? readLeads(logPath, tab) : readLog(logPath);
  const blocklist = readBlocklistCsv(blocklistPath);
  if (blocklist.length === 0) {
    return { content: [{ type: "text", text: "⚠ No blocklist entries. Export from https://eservice.thencc.org.za/ first." }], isError: true };
  }
  const result = cleanse(data.contacts, blocklist);
  let written = false;
  if (write) {
    XLSX.writeFile(type === "leads" ? applyLeadsCleanse(data, result, tab) : applyCleanse(data, result), logPath);
    written = true;
  }
  const text =
    `Checked: ${result.checked}\nBlocklist: ${result.blocklistSize}\n` +
    `Matched (DNC): ${result.matched.length}\n` +
    result.matched.map((m) => ` - ${m.business}${m.contact ? " (" + m.contact + ")" : ""}`).join("\n") +
    (written ? "\n✓ DNC applied." : "\n(dry run)");
  return { content: [{ type: "text", text }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
