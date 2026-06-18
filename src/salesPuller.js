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

async function searchSaleOrderPage(client, { fromDate, toDate, statuses, displayStart, displayLength }) {
  const statusFilter = statuses?.length === 1 ? `<ser:Status>${xmlEscape(statuses[0])}</ser:Status>` : "";
  const body = `<ser:SearchSaleOrderRequest>
    <ser:FromDate>${fromDate}</ser:FromDate>
    <ser:ToDate>${toDate}</ser:ToDate>
    ${statusFilter}
    <ser:SearchOptions>
      <ser:DisplayStart>${displayStart}</ser:DisplayStart>
      <ser:DisplayLength>${displayLength}</ser:DisplayLength>
    </ser:SearchOptions>
  </ser:SearchSaleOrderRequest>`;

  const result = await client.call(body);
  const resp = result.SearchSaleOrderResponse;
  const totalRecords = parseInt(resp.TotalRecords, 10) || 0;
  const orders = asArray(resp.SaleOrders?.SaleOrder);
  return { totalRecords, orders };
}

async function searchAllSaleOrders(client, { fromDate, toDate, statuses, pageSize, onPage }) {
  let displayStart = 0;
  const all = [];
  while (true) {
    const { totalRecords, orders } = await searchSaleOrderPage(client, {
      fromDate,
      toDate,
      statuses,
      displayStart,
      displayLength: pageSize,
    });
    all.push(...orders);
    if (onPage) onPage(all.length, totalRecords);
    displayStart += pageSize;
    if (displayStart >= totalRecords || orders.length === 0) break;
  }
  return all;
}

async function getSaleOrderLineItems(client, orderCode) {
  const body = `<ser:GetSaleOrderRequest>
    <ser:SaleOrder>
      <ser:Code>${xmlEscape(orderCode)}</ser:Code>
    </ser:SaleOrder>
    <ser:IsPaymentDetailRequired>false</ser:IsPaymentDetailRequired>
  </ser:GetSaleOrderRequest>`;

  const result = await client.call(body);
  const resp = result.GetSaleOrderResponse;
  const order = resp.SaleOrder;
  if (!order) return { channelCode: null, status: null, items: [] };

  const items = asArray(order.SaleOrderItems?.SaleOrderItem).map((item) => ({
    itemSku: item.ItemSKU,
    facilityCode: item.FacilityCode || null,
    statusCode: item.StatusCode,
  }));

  return {
    channelCode: order.Channel || null,
    status: order.Status || null,
    createdOn: order.CreatedOn,
    items,
  };
}

/**
 * Runs async tasks with a bounded number in flight at once, instead of fully sequential
 * or fully parallel (Unicommerce's API has no documented bulk order-detail endpoint, and
 * order volume can be in the thousands for even a short window).
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * Pulls one row per unit sold in [fromDate, toDate], counting only orders whose status
 * is in countedOrderStatuses (Unicommerce has no Quantity field on SaleOrderItem --
 * each unit is its own line item row).
 */
async function pullSalesHistory(client, { fromDate, toDate, countedOrderStatuses, pageSize, concurrency = 10, onProgress }) {
  const orders = await searchAllSaleOrders(client, {
    fromDate,
    toDate,
    statuses: null, // filter status after GetSaleOrder, since SearchSaleOrder only supports a single exact status
    pageSize,
    onPage: (fetched, total) => onProgress?.(`Searched ${fetched}/${total} orders`),
  });

  const statusSet = new Set(countedOrderStatuses);
  let processed = 0;

  const details = await mapWithConcurrency(orders, concurrency, async (order) => {
    const detail = await getSaleOrderLineItems(client, order.Code);
    processed += 1;
    if (processed % 25 === 0 || processed === orders.length) {
      onProgress?.(`Fetched line items for ${processed}/${orders.length} orders`);
    }
    return detail;
  });

  const rows = [];
  for (const detail of details) {
    if (!statusSet.has(detail.status)) continue;
    for (const item of detail.items) {
      rows.push({
        sku: item.itemSku,
        channelCode: detail.channelCode,
        facilityCode: item.facilityCode,
        orderDate: detail.createdOn,
      });
    }
  }

  return rows;
}

module.exports = { searchAllSaleOrders, getSaleOrderLineItems, pullSalesHistory };
