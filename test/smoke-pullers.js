require("dotenv").config();
const { UnicommerceClient, SoapFault } = require("../src/soapClient");
const { searchAllSaleOrders, getSaleOrderLineItems } = require("../src/salesPuller");
const { pullInventorySnapshot } = require("../src/inventoryPuller");
const config = require("../config/config");

(async () => {
  const client = new UnicommerceClient(config.unicommerce);

  try {
    const toDate = new Date().toISOString();
    const fromDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    console.log("Searching sale orders from", fromDate, "to", toDate);

    const orders = await searchAllSaleOrders(client, {
      fromDate,
      toDate,
      statuses: null,
      pageSize: 20,
      onPage: (fetched, total) => console.log(`  page: ${fetched}/${total}`),
    });
    console.log(`Found ${orders.length} orders. First 3:`, orders.slice(0, 3));

    if (orders.length > 0) {
      const detail = await getSaleOrderLineItems(client, orders[0].Code);
      console.log("First order detail:", JSON.stringify(detail, null, 2));

      if (detail.items.length > 0) {
        const sku = detail.items[0].itemSku;
        console.log("\nTesting GetBulkItemTypeInventory for SKU:", sku);
        const inv = await pullInventorySnapshot(client, {
          skuCodes: [sku],
          facilityCodes: config.facilityCodes,
        });
        console.log("Inventory result:", inv);
      }
    }
  } catch (e) {
    if (e instanceof SoapFault) {
      console.error("SOAP FAULT:", e.message);
    } else {
      console.error("ERROR:", e);
    }
  }
})();
