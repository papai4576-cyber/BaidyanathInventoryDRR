require("dotenv").config();

function intEnv(name, fallback) {
  const v = process.env[name];
  return v ? parseInt(v, 10) : fallback;
}

module.exports = {
  unicommerce: {
    tenantUrl: process.env.UNICOMMERCE_TENANT_URL,
    username: process.env.UNICOMMERCE_USERNAME,
    apiKey: process.env.UNICOMMERCE_API_KEY,
    version: "1.9",
  },

  googleSheets: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || "./secrets/service-account.json",
    tabName: "Inventory_DRR",
  },

  // DRR window: how many trailing days of sales to average over. Configurable per the
  // business's request -- not hardcoded to a fixed 7/14/30 day assumption.
  drrWindowDays: intEnv("DRR_WINDOW_DAYS", 14),

  // A SKU is flagged for reorder when days-of-cover drops below this.
  reorderThresholdDays: intEnv("REORDER_THRESHOLD_DAYS", 10),

  // Used for suggested reorder quantity = drr * (leadTimeDays + safetyStockDays) - currentStock
  leadTimeDays: intEnv("LEAD_TIME_DAYS", 7),
  safetyStockDays: intEnv("SAFETY_STOCK_DAYS", 5),

  // Only orders in these statuses count toward sales velocity (excludes cancelled orders etc).
  // Adjust this list if Unicommerce's actual status codes for this account differ.
  countedOrderStatuses: ["COMPLETE", "DISPATCHED", "DELIVERED"],

  // Pagination size for SearchSaleOrder.
  searchPageSize: 100,

  // How many GetSaleOrder calls to run concurrently when fetching line items.
  // Order volume can be in the thousands even for short windows -- bounded
  // concurrency keeps the daily run fast without hammering Unicommerce's API.
  getSaleOrderConcurrency: intEnv("GET_SALE_ORDER_CONCURRENCY", 10),
};
