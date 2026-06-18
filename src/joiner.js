const {
  computeDRR,
  computeDaysOfCover,
  computeReorderFlag,
  computeSuggestedReorderQty,
} = require("./drrEngine");

/**
 * Builds the final per-SKU-per-channel-per-facility table.
 *
 * Rows are driven by sales groups (sku, channelCode, facilityCode) -- a SKU with stock but
 * zero recent sales in the window won't appear here, since there's no channel to attribute
 * it to. Current Stock is intentionally repeated across every channel row sharing a
 * (sku, facilityCode) pair -- it must never be summed across channel rows, since stock is
 * shared, not channel-specific.
 */
function buildInventoryDrrTable(salesRows, inventoryRows, config) {
  const drrMap = computeDRR(salesRows, config.drrWindowDays);

  const stockIndex = new Map();
  for (const row of inventoryRows) {
    stockIndex.set(`${row.sku}::${row.facilityCode}`, row.currentStock);
  }

  const rows = [];
  for (const { sku, channelCode, facilityCode, drr } of drrMap.values()) {
    const currentStock = stockIndex.get(`${sku}::${facilityCode}`) ?? 0;
    const daysOfCover = computeDaysOfCover(currentStock, drr);
    const reorderFlag = computeReorderFlag(daysOfCover, config.reorderThresholdDays);
    const suggestedReorderQty = computeSuggestedReorderQty(
      drr,
      config.leadTimeDays,
      currentStock,
      config.safetyStockDays
    );

    rows.push({
      sku,
      channelCode: channelCode || "(unknown)",
      facilityCode,
      currentStock,
      drr,
      daysOfCover,
      reorderFlag,
      suggestedReorderQty,
    });
  }

  return rows;
}

module.exports = { buildInventoryDrrTable };
