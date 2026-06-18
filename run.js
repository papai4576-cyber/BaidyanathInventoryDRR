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

  const table = buildInventoryDrrTable(salesRows, inventoryRows, config);
  log(`Built final table with ${table.length} rows.`);

  const flagged = table.filter((r) => r.reorderFlag).length;
  log(`${flagged} rows flagged for reorder.`);

  await writeInventoryDrrTable(table, {
    sheetId: config.googleSheets.sheetId,
    serviceAccountKeyPath: config.googleSheets.serviceAccountKeyPath,
    tabName: config.googleSheets.tabName,
    drrWindowDays: config.drrWindowDays,
  });
  log(`Wrote table to Google Sheet (tab "${config.googleSheets.tabName}").`);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] FATAL:`, err);
  process.exit(1);
});
