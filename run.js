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
  log(`Pulling sales history from ${fromDate} to ${toDate} (window=${config.drrWindowDays}d)`);

  const salesRows = await pullSalesHistory(client, {
    fromDate,
    toDate,
    countedOrderStatuses: config.countedOrderStatuses,
    pageSize: config.searchPageSize,
    concurrency: config.getSaleOrderConcurrency,
    onProgress: (msg) => log(msg),
  });
  log(`Pulled ${salesRows.length} sold-unit rows.`);

  const unknownChannelCount = salesRows.filter((r) => !r.channelCode).length;
  if (unknownChannelCount > 0) {
    log(`WARNING: ${unknownChannelCount} sold-unit rows have no ChannelCode -- check for dropped/unexpected channel values.`);
  }

  const distinctSkus = [...new Set(salesRows.map((r) => r.sku).filter(Boolean))];
  const distinctFacilities = [...new Set(salesRows.map((r) => r.facilityCode).filter(Boolean))];
  log(`Pulling inventory snapshot for ${distinctSkus.length} SKUs across ${distinctFacilities.length} facilities (${distinctFacilities.join(", ")}).`);

  const inventoryRows = await pullInventorySnapshot(client, {
    skuCodes: distinctSkus,
    facilityCodes: distinctFacilities,
  });
  log(`Pulled ${inventoryRows.length} inventory rows.`);

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
