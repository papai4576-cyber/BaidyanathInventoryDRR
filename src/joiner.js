const {
  computeDRR,
  computeDaysOfCover,
  computeReorderFlag,
  computeSuggestedReorderQty,
} = require("./drrEngine");

/**
 * Builds one pivoted table per facility: rows are every SKU stocked at that facility
 * (the full catalog, from inventoryRows -- not just SKUs that sold recently), columns are
 * channels observed in sales (DRR per channel), plus a Total DRR column summing across
 * channels. A catalog SKU with no recent sales still appears, with channelDrr={}, totalDrr=0,
 * and daysOfCover=null (NO_SALES status) -- it's just not attributable to reorder urgency.
 *
 * Stock is shared across channels at a facility, so Days of Cover / Reorder Flag /
 * Suggested Reorder Qty are computed from Total DRR against that shared stock -- never from
 * a single channel's DRR.
 */
function buildInventoryDrrTable(salesRows, inventoryRows, config) {
  const drrMap = computeDRR(salesRows, config.drrWindowDays);

  // `${sku}::${facilityCode}` -> Map(channel -> drr)
  const drrBySkuFacility = new Map();
  for (const { sku, channelCode, facilityCode, drr } of drrMap.values()) {
    const channel = channelCode || "(unknown)";
    const key = `${sku}::${facilityCode}`;
    if (!drrBySkuFacility.has(key)) drrBySkuFacility.set(key, new Map());
    drrBySkuFacility.get(key).set(channel, drr);
  }

  // facilityCode -> sku -> inventory row (itemName, currentStock)
  const facilities = new Map();
  for (const row of inventoryRows) {
    if (!facilities.has(row.facilityCode)) facilities.set(row.facilityCode, new Map());
    facilities.get(row.facilityCode).set(row.sku, row);
  }

  const facilityTables = [];
  for (const [facilityCode, skuMap] of facilities) {
    const channelsSet = new Set();
    for (const sku of skuMap.keys()) {
      const channelDrrMap = drrBySkuFacility.get(`${sku}::${facilityCode}`);
      if (channelDrrMap) for (const channel of channelDrrMap.keys()) channelsSet.add(channel);
    }
    const channels = [...channelsSet].sort();

    const rows = [];
    for (const [sku, invRow] of skuMap) {
      const channelDrrMap = drrBySkuFacility.get(`${sku}::${facilityCode}`) || new Map();
      const channelDrr = Object.fromEntries(channelDrrMap);
      const totalDrr = [...channelDrrMap.values()].reduce((sum, drr) => sum + drr, 0);
      const currentStock = invRow.currentStock;

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
        productName: invRow.itemName || "",
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
