#!/usr/bin/env node
// Windows-friendly launcher for the packaged .exe. Reads config.json sitting
// next to the executable, populates process.env, runs the sync, and pauses
// so warehouse users can read the log before the console window closes.

const fs = require("fs");
const path = require("path");
const readline = require("readline");

function exeDir() {
  // When packaged with pkg/@yao-pkg/pkg, process.pkg is truthy and
  // process.execPath points at the .exe on disk. In dev (plain node) fall
  // back to the project root.
  if (process.pkg) return path.dirname(process.execPath);
  return path.resolve(__dirname, "..");
}

function loadConfigJson(dir) {
  const configPath = path.join(dir, "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.json not found next to the app at:\n  ${configPath}\n\n` +
      `Copy config.example.json to config.json and fill in your credentials.`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse config.json: ${err.message}`);
  }
}

function applyEnv(cfg, dir) {
  const map = {
    UNICOMMERCE_TENANT_URL: cfg.unicommerceTenantUrl,
    UNICOMMERCE_USERNAME: cfg.unicommerceUsername,
    UNICOMMERCE_API_KEY: cfg.unicommerceApiKey,
    GOOGLE_SHEET_ID: cfg.googleSheetId,
    DRR_WINDOW_DAYS: cfg.drrWindowDays,
    REORDER_THRESHOLD_DAYS: cfg.reorderThresholdDays,
    LEAD_TIME_DAYS: cfg.leadTimeDays,
    SAFETY_STOCK_DAYS: cfg.safetyStockDays,
    GET_SALE_ORDER_CONCURRENCY: cfg.getSaleOrderConcurrency,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined && v !== null && v !== "") process.env[k] = String(v);
  }

  // Resolve the service account key path against the exe directory so a
  // relative value like "service-account.json" works regardless of where
  // the user double-clicks from.
  const keyPath = cfg.googleServiceAccountKeyPath || "service-account.json";
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = path.isAbsolute(keyPath)
    ? keyPath
    : path.join(dir, keyPath);
}

function pause() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\nPress Enter to close this window...", () => {
      rl.close();
      resolve();
    });
  });
}

async function run() {
  const dir = exeDir();
  console.log(`Baidyanath Inventory DRR`);
  console.log(`App folder: ${dir}\n`);

  try {
    const cfg = loadConfigJson(dir);
    applyEnv(cfg, dir);
  } catch (err) {
    console.error(`CONFIG ERROR: ${err.message}`);
    await pause();
    process.exit(1);
  }

  let main;
  try {
    ({ main } = require("../run.js"));
  } catch (err) {
    console.error(`Failed to load app: ${err.stack || err.message}`);
    await pause();
    process.exit(1);
  }

  try {
    await main();
    console.log(`\nDone. The Google Sheet has been updated.`);
    await pause();
  } catch (err) {
    console.error(`\nFAILED: ${err.stack || err.message}`);
    await pause();
    process.exit(1);
  }
}

run();
