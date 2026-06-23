function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Unicommerce's catalog has inconsistent brand casing for the same vendor (confirmed live:
// "Goodcare"/"GOODCARE", "Baidyanath"/"BAIDYANATH") -- normalize known brands to one
// canonical form so the same vendor doesn't show up as two different-looking values in the
// sheet. Anything not in this list is passed through as-is (trimmed only).
const BRAND_CANONICAL = { GOODCARE: "GOODCARE", BAIDYANATH: "BAIDYANATH" };

function normalizeBrand(rawBrand) {
  if (!rawBrand) return null;
  const trimmed = rawBrand.trim();
  return BRAND_CANONICAL[trimmed.toUpperCase()] || trimmed;
}

async function fetchCatalogPage(client, { displayStart, displayLength }) {
  const body = `<ser:SearchItemTypesRequest>
    <ser:GetInventorySnapshot>true</ser:GetInventorySnapshot>
    <ser:SearchOptions>
      <ser:DisplayStart>${displayStart}</ser:DisplayStart>
      <ser:DisplayLength>${displayLength}</ser:DisplayLength>
    </ser:SearchOptions>
  </ser:SearchItemTypesRequest>`;

  const result = await client.call(body);
  const resp = result.SearchItemTypesResponse;
  const totalRecords = parseInt(resp.TotalRecords, 10) || 0;
  const items = asArray(resp.ItemTypes?.ItemType);
  return { totalRecords, items };
}

/**
 * Pulls current stock for the FULL Unicommerce catalog (not just SKUs that sold recently)
 * via SearchItemTypes with GetInventorySnapshot=true, which embeds per-facility stock
 * directly in the same paginated call -- confirmed live: a single SKU can carry multiple
 * InventorySnapshot entries (one per facility it's stocked at). Unlike
 * GetBulkItemTypeInventory's confirmed 50-SKU cap, DisplayLength=500 here returns a full
 * page with no error, so paginating in larger chunks is safe.
 *
 * Returns [{ sku, itemName, brand, facilityCode, currentStock }], one row per (sku, facility).
 */
async function pullInventorySnapshot(client, { pageSize = 500, onProgress } = {}) {
  let displayStart = 0;
  const rows = [];

  while (true) {
    const { totalRecords, items } = await fetchCatalogPage(client, { displayStart, displayLength: pageSize });

    for (const item of items) {
      // Trimmed because Unicommerce's Name has stray leading/trailing whitespace on some
      // catalog entries, which throws off Sheet column alignment.
      const itemName = item.Name ? item.Name.trim() : null;
      const brand = normalizeBrand(item.Brand);
      for (const snapshot of asArray(item.InventorySnapshots?.InventorySnapshot)) {
        rows.push({
          sku: item.SKUCode,
          itemName,
          brand,
          facilityCode: snapshot.Facility,
          currentStock: parseInt(snapshot.Inventory, 10) || 0,
        });
      }
    }

    displayStart += pageSize;
    if (onProgress) onProgress(`Pulled catalog ${Math.min(displayStart, totalRecords)}/${totalRecords} SKUs`);
    if (displayStart >= totalRecords || items.length === 0) break;
  }

  return rows;
}

module.exports = { pullInventorySnapshot };
