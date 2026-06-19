const assert = require("assert");
const {
  computeDRR,
  computeDaysOfCover,
  computeReorderFlag,
  computeSuggestedReorderQty,
  computeReorderStatus,
} = require("../src/drrEngine");

// 14-day window, SKU A sold 7 units on Shopify, 3 on Amazon, both facility F1.
const sales = [
  ...Array(7).fill({ sku: "A", channelCode: "SHOPIFY", facilityCode: "F1" }),
  ...Array(3).fill({ sku: "A", channelCode: "AMAZON", facilityCode: "F1" }),
];

const drrMap = computeDRR(sales, 14);
assert.strictEqual(drrMap.get("A::SHOPIFY::F1").drr, 0.5);
assert.strictEqual(drrMap.get("A::AMAZON::F1").drr, 3 / 14);

// Days of cover and reorder flag
assert.strictEqual(computeDaysOfCover(100, 0.5), 200);
assert.strictEqual(computeDaysOfCover(100, 0), null);
assert.strictEqual(computeReorderFlag(5, 10), true);
assert.strictEqual(computeReorderFlag(15, 10), false);
assert.strictEqual(computeReorderFlag(null, 10), false);

// Suggested reorder qty: drr=0.5, leadTime=7, safety=5 -> target=6, stock=2 -> need 4
assert.strictEqual(computeSuggestedReorderQty(0.5, 7, 2, 5), 4);
// Stock already above target -> 0, never negative
assert.strictEqual(computeSuggestedReorderQty(0.5, 7, 100, 5), 0);
// Zero DRR -> 0
assert.strictEqual(computeSuggestedReorderQty(0, 7, 2, 5), 0);

// Reorder status tiers (reorderThresholdDays=10, default watchMultiplier=2)
assert.strictEqual(computeReorderStatus(null, 10), "NO_SALES");
assert.strictEqual(computeReorderStatus(5, 10), "REORDER");
assert.strictEqual(computeReorderStatus(9.9, 10), "REORDER");
assert.strictEqual(computeReorderStatus(10, 10), "WATCH");
assert.strictEqual(computeReorderStatus(19.9, 10), "WATCH");
assert.strictEqual(computeReorderStatus(20, 10), "HEALTHY");
assert.strictEqual(computeReorderStatus(100, 10), "HEALTHY");
// Custom watchMultiplier
assert.strictEqual(computeReorderStatus(25, 10, 3), "WATCH");
assert.strictEqual(computeReorderStatus(30, 10, 3), "HEALTHY");

console.log("All drrEngine fixture checks passed.");
