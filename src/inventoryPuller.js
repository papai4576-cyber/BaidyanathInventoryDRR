function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Unicommerce's GetBulkItemTypeInventory rejects requests with more than 50 SKU codes
// ("skuCodes Maximum 50 sku codes are allowed") -- confirmed by hitting that error live.
const MAX_SKUS_PER_CALL = 50;

async function fetchInventoryBatch(client, { skuCodes, facilityCodes }) {
  const skuXml = skuCodes.map((s) => `<ser:SkuCode>${xmlEscape(s)}</ser:SkuCode>`).join("\n");
  const facilityXml = facilityCodes.map((f) => `<ser:FacilityCode>${xmlEscape(f)}</ser:FacilityCode>`).join("\n");

  const body = `<ser:GetBulkItemTypeInventoryRequest>
    <ser:SkuCodes>
      ${skuXml}
    </ser:SkuCodes>
    <ser:FacilityCodes>
      ${facilityXml}
    </ser:FacilityCodes>
  </ser:GetBulkItemTypeInventoryRequest>`;

  const result = await client.call(body);
  const resp = result.GetBulkItemTypeInventoryResponse;
  const itemInventories = asArray(resp.InventoryDetails?.ItemInventory);

  const rows = [];
  for (const item of itemInventories) {
    const facilities = asArray(item.Facilities?.FacilityInventory);
    for (const facility of facilities) {
      rows.push({
        sku: item.ItemSKU,
        facilityCode: facility.FacilityCode,
        currentStock: parseInt(facility.Inventory, 10) || 0,
      });
    }
  }
  return rows;
}

/**
 * Pulls current stock for the given SKUs across the given facilities, batching SKUs into
 * groups of MAX_SKUS_PER_CALL to stay within Unicommerce's per-request limit.
 * Returns [{ sku, facilityCode, currentStock }].
 */
async function pullInventorySnapshot(client, { skuCodes, facilityCodes }) {
  const batches = chunk(skuCodes, MAX_SKUS_PER_CALL);
  const results = [];
  for (const batch of batches) {
    const rows = await fetchInventoryBatch(client, { skuCodes: batch, facilityCodes });
    results.push(...rows);
  }
  return results;
}

module.exports = { pullInventorySnapshot };
