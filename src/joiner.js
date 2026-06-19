const {
  computeDRR,
  computeDaysOfCover,
  computeReorderFlag,
  computeSuggestedReorderQty,
} = require("./drrEngine");

/**
 * Builds one pivoted table per facility: rows are SKUs, columns are channels (DRR per
 * channel), plus a Total DRR column summing across channels. Stock is shared across
 * channels at a facility, so Days of Cover / Reorder Flag / Suggested Reorder Qty are
 * computed from Total DRR against that shared stock -- never from a single channel's DRR.
 *
 * A SKU with stock but zero recent sales in the window won't appear, since there's no
 * channel to attribute it to.
 */
function buildInventoryDrrTable(salesRows, inventoryRows, config) {
  const drrMap = computeDRR(salesRows, config.drrWindowDays);

  const stockIndex = new Map();
  const nameIndex = new Map();
  for (const row of inventoryRows) {
    stockIndex.set(`${row.sku}::${row.facilityCode}`, row.currentStock);
    if (row.itemName && !nameIndex.has(row.sku)) nameIndex.set(row.sku, row.itemName);
  }

  // facilityCode -> sku -> { channelDrr: Map(channel -> drr) }
  const facilities = new Map();
  for (const { sku, channelCode, facilityCode, drr } of drrMap.values()) {
    const channel = channelCode || "(unknown)";
    if (!facilities.has(facilityCode)) facilities.set(facilityCode, new Map());
    const skuMap = facilities.get(facilityCode);
    if (!skuMap.has(sku)) skuMap.set(sku, new Map());
    skuMap.get(sku).set(channel, drr);
  }

  const facilityTables = [];
  for (const [facilityCode, skuMap] of facilities) {
    const channels = [...new Set([].concat(...[...skuMap.values()].map((m) => [...m.keys()])))].sort();

    const rows = [];
    for (const [sku, channelDrrMap] of skuMap) {
      const currentStock = stockIndex.get(`${sku}::${facilityCode}`) ?? 0;
      const channelDrr = Object.fromEntries(channelDrrMap);
      const totalDrr = [...channelDrrMap.values()].reduce((sum, drr) => sum + drr, 0);

      const daysOfCover = computeDaysOfCover(currentStock, totalDrr);
      const reorderFlag = computeReorderFlag(daysOfCover, config.reorderThresholdDays);
      const suggestedReorderQty = computeSuggestedReorderQty(
        totalDrr,
        config.leadTimeDays,
        currentStock,
        config.safetyStockDays
      );

      rows.push({
        sku,
        productName: nameIndex.get(sku) || "",
        currentStock,
        channelDrr,
        totalDrr,
        daysOfCover,
        reorderFlag,
        suggestedReorderQty,
      });
    }
    rows.sort((a, b) => a.sku.localeCompare(b.sku));

    facilityTables.push({ facilityCode, channels, rows });
  }
  facilityTables.sort((a, b) => a.facilityCode.localeCompare(b.facilityCode));

  return facilityTables;
}

module.exports = { buildInventoryDrrTable };
