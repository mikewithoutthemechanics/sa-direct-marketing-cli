# sa-direct-marketing-cli

POPIA s69 + CPA Amendment Regulations 2026 compliant direct-marketing tooling for
South African outreach. Ships a **CLI** and an **MCP server** (stdio) that do the
same job: the **monthly NCC opt-out registry cleanse**.

## Why this exists

The National Consumer Commission (NCC) opt-out registry
(`https://eservice.thencc.org.za/`) went live **15 April 2026**. The 2026
Amendment Regulations make it mandatory for direct marketers to:

- register as a direct marketer with the NCC (annual renewal, fee ~ZAR 2,574),
- **cleanse their marketing database against the registry monthly**, and
- never market to a consumer who registered a pre-emptive block.

The registry has **no public API** — it is a web portal. So this tool cross-
references your active list against a **blocklist CSV you export from the portal**.

## Install

```bash
npm install
npm run build
npm link            # exposes `sa-dm`
```

## Usage

```bash
# Dry run (reports matches, writes nothing)
sa-dm cleanse --log KZN_Outreach_Compliance_Log.xlsx --blocklist ncc-export.csv

# Apply DNC changes (flips matched rows, appends to DNC Register)
sa-dm cleanse --log KZN_Outreach_Compliance_Log.xlsx --blocklist ncc-export.csv --write

# Also supports the MASTER LEADS list (KZN_Plumbers_Master.xlsx style):
sa-dm cleanse --log KZN_Plumbers_Master.xlsx --type leads --blocklist ncc-export.csv --write
#   -> adds a "DNC (Y/N)" column if absent, flips matches, appends a DNC Register tab
```

The `--type` switch selects the workbook schema:
- `log` (default) — the compliance log with `Consent & DNC Log` + `DNC Register` tabs
- `leads` — a master plumbers list (`All KZN Plumbers` tab); DNC column is created on write

## MCP server

```bash
node dist/mcp.js
```

Exposes one tool: `cleanse_marketing_list(logPath, blocklistPath, type?, write?)`.
Wire it into Hermes or any MCP client that supports stdio servers. Registered in
Hermes as `sa-direct-marketing` (discovered + enabled).

## Compliance notes (not legal advice)

- This automates the *mechanical* cleanse. The human step — exporting the
  registry blocklist from the NCC portal and registering as a marketer — remains
  yours.
- POPIA opt-in consent is still required before any electronic marketing to
  non-customers; the registry cleanse is an *additional* obligation, not a
  substitute.
- Per the 2026 Regulations, a pre-emptive block supersedes earlier consent.

## License

MIT
