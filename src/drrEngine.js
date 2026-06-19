/**
 * salesRows: [{ sku, channelCode, facilityCode }] -- one row per unit sold (see salesPuller.js
 * notes on why Unicommerce has no Quantity field).
 * Returns a Map keyed by `${sku}::${channelCode}::${facilityCode}` -> { sku, channelCode, facilityCode, drr }
 */
function computeDRR(salesRows, windowDays) {
  const counts = new Map();
  for (const row of salesRows) {
    const key = `${row.sku}::${row.channelCode}::${row.facilityCode}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const result = new Map();
  for (const [key, unitsSold] of counts) {
    const [sku, channelCode, facilityCode] = key.split("::");
    result.set(key, { sku, channelCode, facilityCode, drr: unitsSold / windowDays });
  }
  return result;
}

/**
 * Returns null (not a numeric days-of-cover) when there's no recent sales velocity --
 * this must be distinguished from "0 days of cover" by callers, not collapsed into NaN/Infinity.
 */
function computeDaysOfCover(currentStock, drr) {
  if (!drr || drr <= 0) return null;
  return currentStock / drr;
}

function computeReorderFlag(daysOfCover, reorderThresholdDays) {
  if (daysOfCover === null) return false;
  return daysOfCover < reorderThresholdDays;
}

function computeSuggestedReorderQty(drr, leadTimeDays, currentStock, safetyStockDays) {
  if (!drr || drr <= 0) return 0;
  const targetStock = drr * (leadTimeDays + safetyStockDays);
  return Math.max(0, Math.round(targetStock - currentStock));
}

/**
 * Tiered status for presentation layers (e.g. an icon set in the sheet), distinct from the
 * boolean computeReorderFlag -- NO_SALES (no recent velocity) is deliberately not the same
 * as HEALTHY, since there's no basis to call it either good or bad.
 */
function computeReorderStatus(daysOfCover, reorderThresholdDays, watchMultiplier = 2) {
  if (daysOfCover === null) return "NO_SALES";
  if (daysOfCover < reorderThresholdDays) return "REORDER";
  if (daysOfCover < reorderThresholdDays * watchMultiplier) return "WATCH";
  return "HEALTHY";
}

module.exports = {
  computeDRR,
  computeDaysOfCover,
  computeReorderFlag,
  computeSuggestedReorderQty,
  computeReorderStatus,
};
