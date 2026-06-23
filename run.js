const config = require("./config/config");
const { UnicommerceClient } = require("./src/soapClient");
const { pullSalesHistory } = require("./src/salesPuller");
const { pullInventorySnapshot } = require("./src/inventoryPuller");
const { buildInventoryDrrTable } = require("./src/joiner");
const { writeInventoryDrrTable } = require("./src/sheetsWriter");

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const client = new UnicommerceClient(config.unicommerce);

  const toDate = new Date().toISOString();
  const fromDate = new Date(Date.now() - config.drrWindowDays * 24 * 60 * 60 * 1000).toISOString();
  log(`Pulling sales history from ${fromDate} to ${toDate} (window=${config.drrWindowDays}d) and full catalog inventory in parallel.`);

  // Independent pulls: inventory now comes from the full catalog (SearchItemTypes), not
  // SKUs derived from sales, so it no longer needs to wait on the sales pull first.
  const [salesRows, inventoryRows] = await Promise.all([
    pullSalesHistory(client, {
      fromDate,
      toDate,
      countedOrderStatuses: config.countedOrderStatuses,
      pageSize: config.searchPageSize,
      concurrency: config.getSaleOrderConcurrency,
      onProgress: (msg) => log(msg),
    }),
    pullInventorySnapshot(client, {
      onProgress: (msg) => log(msg),
    }),
  ]);
  log(`Pulled ${salesRows.length} sold-unit rows and ${inventoryRows.length} catalog inventory rows.`);

  const unknownChannelCount = salesRows.filter((r) => !r.channelCode).length;
  if (unknownChannelCount > 0) {
    log(`WARNING: ${unknownChannelCount} sold-unit rows have no ChannelCode -- check for dropped/unexpected channel values.`);
  }

  const facilityTables = buildInventoryDrrTable(salesRows, inventoryRows, config);
  const totalRows = facilityTables.reduce((sum, f) => sum + f.rows.length, 0);
  const flagged = facilityTables.reduce((sum, f) => sum + f.rows.filter((r) => r.reorderFlag).length, 0);
  log(`Built ${facilityTables.length} facility tables (${totalRows} SKU rows total, ${flagged} flagged for reorder).`);

  await writeInventoryDrrTable(facilityTables, {
    sheetId: config.googleSheets.sheetId,
    serviceAccountKeyPath: config.googleSheets.serviceAccountKeyPath,
    drrWindowDays: config.drrWindowDays,
    reorderThresholdDays: config.reorderThresholdDays,
    legacyTabName: config.googleSheets.legacyTabName,
    syncedAt: new Date().toISOString(),
  });
  log(`Wrote ${facilityTables.length} facility tabs to Google Sheet: ${facilityTables.map((f) => f.facilityCode).join(", ")}.`);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL:`, err);
  process.exit(1);
});
