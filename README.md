# Baidyanath Inventory DRR

Pulls sales history and inventory from Unicommerce (SOAP, Uniware 1.9), computes
daily run rate and reorder flags per facility, and writes one tab per facility
to a Google Sheet.

## Why run locally

Unicommerce blocks GitHub-owned IP ranges, so this job cannot be run from
GitHub Actions or any cloud runner that egresses through GitHub's network.
Run it on a local machine (or any host with an allow-listed IP) instead.
The same setup works on any number of machines — clone, configure `.env`,
run.

## Prerequisites

- Node.js 18 or newer
- A Unicommerce API user (username + API key) for the tenant
- A Google Cloud service account with the Sheets API enabled, shared as an
  editor on the target sheet

## Setup

```bash
git clone https://github.com/papai4576-cyber/BaidyanathInventoryDRR.git
cd BaidyanathInventoryDRR
npm install
```

Copy the environment template and fill in credentials:

```bash
cp .env.example .env
```

Edit `.env`:

- `UNICOMMERCE_TENANT_URL` — tenant base URL (default is set).
- `UNICOMMERCE_USERNAME` — API user's login.
- `UNICOMMERCE_API_KEY` — API key from Unicommerce.
- `GOOGLE_SHEET_ID` — the ID from the sheet URL (`.../spreadsheets/d/<ID>/edit`).
- `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — path to the service account JSON key.

Drop the Google service account JSON at the path you set (default
`./secrets/service-account.json`):

```bash
mkdir -p secrets
# copy the downloaded key into secrets/service-account.json
```

Share the target Google Sheet with the service account's email address as an
editor.

## Run

```bash
npm start
```

The job pulls sales for the trailing `DRR_WINDOW_DAYS` (default 14) plus the
full inventory snapshot in parallel, builds the per-facility tables, and
writes one tab per facility to the sheet.

## Optional tunables

Set any of these in `.env` to override the defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DRR_WINDOW_DAYS` | 14 | Trailing days of sales to average |
| `REORDER_THRESHOLD_DAYS` | 10 | Flag SKUs below this many days of cover |
| `LEAD_TIME_DAYS` | 7 | Used in suggested reorder quantity |
| `SAFETY_STOCK_DAYS` | 5 | Used in suggested reorder quantity |
| `GET_SALE_ORDER_CONCURRENCY` | 10 | Parallelism for `GetSaleOrder` calls |

## Scheduling on a local machine

To run daily, use the OS scheduler on the machine that owns the allow-listed
IP:

- macOS / Linux: `cron` (e.g. `0 6 * * * cd /path/to/repo && /usr/bin/npm start >> run.log 2>&1`)
- Windows: Task Scheduler pointing at `npm start` in the repo directory

## Repo layout

- `run.js` — entry point
- `src/soapClient.js` — Unicommerce SOAP client
- `src/salesPuller.js`, `src/inventoryPuller.js` — data pulls
- `src/joiner.js` — builds the per-facility DRR tables
- `src/sheetsWriter.js` — writes tabs to the Google Sheet
- `config/config.js` — reads env vars
- `docs/` — SOAP operation notes and WSDL
