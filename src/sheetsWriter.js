const { google } = require("googleapis");
const { computeReorderStatus } = require("./drrEngine");
const { withRetry } = require("./retry");

const SUMMARY_TAB_NAME = "Summary";

// Layout: row 0 = last-synced banner, row 1 = header, row 2+ = data. Single source of
// truth so every range below stays consistent if the layout ever shifts again.
const BANNER_ROW_INDEX = 0;
const HEADER_ROW_INDEX = 1;
const DATA_START_ROW_INDEX = 2;

const STATUS_EMOJI = { REORDER: "🔴", WATCH: "🟡", HEALTHY: "🟢", NO_SALES: "⚪" };

const HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 };
const BORDER_COLOR = { red: 0.4, green: 0.4, blue: 0.4 };
const HEADER_UNDERLINE_COLOR = { red: 0.2, green: 0.2, blue: 0.2 };
const BAND_FIRST_COLOR = { red: 1, green: 1, blue: 1 };
const BAND_SECOND_COLOR = { red: 0.95, green: 0.95, blue: 0.97 };

// Cycled deterministically by a facility's position in the already sorted facilityTables
// array, so tab colors stay stable across runs without any extra bookkeeping.
const TAB_COLOR_PALETTE = [
  { red: 0.26, green: 0.52, blue: 0.96 }, // blue
  { red: 0.2, green: 0.66, blue: 0.33 }, // green
  { red: 0.92, green: 0.49, blue: 0.13 }, // orange
  { red: 0.61, green: 0.35, blue: 0.71 }, // purple
  { red: 0.84, green: 0.2, blue: 0.32 }, // red
];
function tabColorFor(index) {
  return TAB_COLOR_PALETTE[index % TAB_COLOR_PALETTE.length];
}

// Google Sheets tab names can't contain these characters.
function sanitizeTabName(facilityCode) {
  return facilityCode.replace(/[:\\/?*\[\]]/g, "_").slice(0, 100);
}

function buildBannerRow(syncedAt, drrWindowDays) {
  return [`Last synced: ${syncedAt} | DRR window: ${drrWindowDays} days`];
}

function buildHeader(channels, drrWindowDays) {
  return [
    "SKU",
    "Product Name",
    "Current Stock",
    ...channels,
    `Total DRR (window=${drrWindowDays}d)`,
    "Days of Cover",
    "Reorder Status",
    "Suggested Reorder Qty",
  ];
}

function toSheetRow(row, channels, reorderThresholdDays) {
  const status = computeReorderStatus(row.daysOfCover, reorderThresholdDays);
  return [
    row.sku,
    row.productName,
    row.currentStock,
    ...channels.map((c) => (row.channelDrr[c] !== undefined ? Number(row.channelDrr[c].toFixed(3)) : "")),
    Number(row.totalDrr.toFixed(3)),
    row.daysOfCover === null ? "" : Number(row.daysOfCover.toFixed(1)),
    STATUS_EMOJI[status],
    row.suggestedReorderQty,
  ];
}

// Left-align identifying/text columns (SKU, Product Name), center the Reorder Status, and
// right-align every numeric column -- set explicitly rather than relying on Sheets' default
// type-based alignment, which produced an inconsistent layout in an earlier pass.
function buildAlignmentRequests(sheetId, header, startRowIndex, endRowIndex) {
  const statusColIndex = header.indexOf("Reorder Status");
  const requests = [];

  function alignRange(startColumnIndex, endColumnIndex, horizontalAlignment) {
    if (startColumnIndex >= endColumnIndex) return;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex },
        cell: { userEnteredFormat: { horizontalAlignment } },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });
  }

  alignRange(0, 2, "LEFT"); // SKU, Product Name
  alignRange(2, statusColIndex, "RIGHT"); // Current Stock .. Days of Cover
  alignRange(statusColIndex, statusColIndex + 1, "CENTER"); // Reorder Status
  alignRange(statusColIndex + 1, header.length, "RIGHT"); // Suggested Reorder Qty

  return requests;
}

function buildGradientRequest(sheetId, header, rowCount, reorderThresholdDays) {
  const daysOfCoverColIndex = header.indexOf("Days of Cover");
  if (rowCount === 0) return null;

  const point = (value, color) => ({ color, colorStyle: { rgbColor: color }, type: "NUMBER", value: String(value) });

  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW_INDEX,
            endRowIndex: DATA_START_ROW_INDEX + rowCount,
            startColumnIndex: daysOfCoverColIndex,
            endColumnIndex: daysOfCoverColIndex + 1,
          },
        ],
        gradientRule: {
          minpoint: point(reorderThresholdDays, { red: 0.92, green: 0.49, blue: 0.45 }),
          midpoint: point(reorderThresholdDays * 1.5, { red: 1, green: 0.95, blue: 0.6 }),
          maxpoint: point(reorderThresholdDays * 3, { red: 0.58, green: 0.84, blue: 0.65 }),
        },
      },
      index: 0,
    },
  };
}

function buildBandingRequests(sheetId, header, rowCount, existingBandedRangeIds) {
  const requests = (existingBandedRangeIds || []).map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } }));
  if (rowCount === 0) return requests;

  requests.push({
    addBanding: {
      bandedRange: {
        range: {
          sheetId,
          startRowIndex: DATA_START_ROW_INDEX,
          endRowIndex: DATA_START_ROW_INDEX + rowCount,
          startColumnIndex: 0,
          endColumnIndex: header.length,
        },
        rowProperties: {
          firstBandColor: BAND_FIRST_COLOR,
          firstBandColorStyle: { rgbColor: BAND_FIRST_COLOR },
          secondBandColor: BAND_SECOND_COLOR,
          secondBandColorStyle: { rgbColor: BAND_SECOND_COLOR },
        },
      },
    },
  });
  return requests;
}

// Explicit pixel widths instead of autoResizeDimensions: autoResizeDimensions was sizing
// columns to fit the (short) data values and under-sizing for long bold header text (e.g.
// channel codes, "Total DRR (window=14d)") -- combined with wrapStrategy:CLIP and
// right-aligned headers, the overflow silently clipped off the START of the header text
// (anchored to the right edge), which is what made headers unreadable. Sizing explicitly
// from the longest of the header label and every data value in that column avoids relying
// on Sheets' autosize heuristics at all.
function computeColumnWidths(header, dataRows, wideColumnIndex) {
  return header.map((label, col) => {
    let maxLen = label.length;
    for (const row of dataRows) {
      const len = String(row[col] ?? "").length;
      if (len > maxLen) maxLen = len;
    }
    const cap = col === wideColumnIndex ? 450 : 300;
    return Math.min(cap, Math.max(60, maxLen * 8 + 24));
  });
}

function buildColumnWidthRequests(sheetId, header, dataRows, wideColumnIndex) {
  return computeColumnWidths(header, dataRows, wideColumnIndex).map((pixelSize, col) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: col, endIndex: col + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
}

// A sheet has at most one basic filter, so reissuing this every run both gives the header
// row its sort/filter dropdowns AND overwrites any filter a user created by hand anchored
// to the wrong row (e.g. the banner) -- that mis-anchoring is what made the header row
// itself get dragged into a sort instead of staying put.
function buildFilterRequest(sheetId, header, rowCount) {
  return {
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: HEADER_ROW_INDEX,
          endRowIndex: DATA_START_ROW_INDEX + rowCount,
          startColumnIndex: 0,
          endColumnIndex: header.length,
        },
      },
    },
  };
}

function buildBorderRequests(sheetId, header, rowCount) {
  const endRowIndex = DATA_START_ROW_INDEX + rowCount;
  return [
    {
      updateBorders: {
        range: { sheetId, startRowIndex: BANNER_ROW_INDEX, endRowIndex, startColumnIndex: 0, endColumnIndex: header.length },
        top: { style: "SOLID", color: BORDER_COLOR },
        bottom: { style: "SOLID", color: BORDER_COLOR },
        left: { style: "SOLID", color: BORDER_COLOR },
        right: { style: "SOLID", color: BORDER_COLOR },
      },
    },
    {
      updateBorders: {
        range: { sheetId, startRowIndex: HEADER_ROW_INDEX, endRowIndex: HEADER_ROW_INDEX + 1, startColumnIndex: 0, endColumnIndex: header.length },
        bottom: { style: "SOLID_MEDIUM", color: HEADER_UNDERLINE_COLOR },
      },
    },
  ];
}

// Bold/frozen header, banner styling, explicit column widths, a Days-of-Cover heatmap,
// banded rows, a tab color, a sort/filter header, and borders. Conditional format rules
// and bandings are cleared and re-added each run instead of left to accumulate, since this
// runs daily via cron.
function buildFormattingRequests({ sheetId, header, dataRows, existingConditionalFormatCount, existingBandedRangeIds, reorderThresholdDays, tabColor }) {
  const rowCount = dataRows.length;
  const requests = [];

  for (let i = existingConditionalFormatCount - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }
  requests.push(...buildBandingRequests(sheetId, header, rowCount, existingBandedRangeIds));

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: HEADER_ROW_INDEX + 1, frozenColumnCount: 2 },
        tabColor,
        tabColorStyle: { rgbColor: tabColor },
      },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount,tabColor,tabColorStyle",
    },
  });

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: BANNER_ROW_INDEX, endRowIndex: BANNER_ROW_INDEX + 1, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } },
      fields: "userEnteredFormat.textFormat",
    },
  });

  requests.push({
    repeatCell: {
      // Header only -- CLIP stops long, underscore-heavy channel codes from word-breaking
      // mid-token across multiple lines.
      range: { sheetId, startRowIndex: HEADER_ROW_INDEX, endRowIndex: HEADER_ROW_INDEX + 1, startColumnIndex: 0, endColumnIndex: header.length },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
          backgroundColor: HEADER_BG,
          wrapStrategy: "CLIP",
        },
      },
      fields: "userEnteredFormat(textFormat,backgroundColor,wrapStrategy)",
    },
  });

  requests.push(...buildAlignmentRequests(sheetId, header, HEADER_ROW_INDEX, DATA_START_ROW_INDEX + rowCount));

  const gradientRequest = buildGradientRequest(sheetId, header, rowCount, reorderThresholdDays);
  if (gradientRequest) requests.push(gradientRequest);

  requests.push(...buildBorderRequests(sheetId, header, rowCount));
  requests.push(buildFilterRequest(sheetId, header, rowCount));
  requests.push(...buildColumnWidthRequests(sheetId, header, dataRows, 1)); // Product Name

  return requests;
}

function buildSummaryHeader() {
  return ["Facility", "SKUs Tracked", "Reorder-Flagged Count", "Total Suggested Reorder Qty", "Distinct Channels Count"];
}

function buildSummaryRow(facilityTable) {
  const { facilityCode, channels, rows } = facilityTable;
  return [
    facilityCode,
    rows.length,
    rows.filter((r) => r.reorderFlag).length,
    rows.reduce((sum, r) => sum + r.suggestedReorderQty, 0),
    channels.length,
  ];
}

function buildSummaryFormattingRequests({ sheetId, header, dataRows }) {
  const rowCount = dataRows.length;
  const requests = [];

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, index: 0, gridProperties: { frozenRowCount: HEADER_ROW_INDEX + 1 } },
      fields: "index,gridProperties.frozenRowCount",
    },
  });

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: HEADER_ROW_INDEX, endRowIndex: HEADER_ROW_INDEX + 1, startColumnIndex: 0, endColumnIndex: header.length },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_BG, wrapStrategy: "CLIP" } },
      fields: "userEnteredFormat(textFormat,backgroundColor,wrapStrategy)",
    },
  });

  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: HEADER_ROW_INDEX, endRowIndex: DATA_START_ROW_INDEX + rowCount, startColumnIndex: 1, endColumnIndex: header.length },
      cell: { userEnteredFormat: { horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat.horizontalAlignment",
    },
  });

  requests.push(...buildBorderRequests(sheetId, header, rowCount));
  requests.push(buildFilterRequest(sheetId, header, rowCount));
  requests.push(...buildColumnWidthRequests(sheetId, header, dataRows));

  return requests;
}

async function ensureTabExists(sheets, sheetId, tabName, existingTitles) {
  if (existingTitles.has(tabName)) return;

  await withSheetsRetry(
    () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
      }),
    `addSheet(${tabName})`
  );
  existingTitles.add(tabName);
}

// Deletes the old single combined tab, now superseded by one tab per facility. Must run
// after the per-facility tabs are created, since Google Sheets requires every spreadsheet
// to keep at least one sheet.
async function deleteLegacyTab(sheets, sheetId, legacyTabName) {
  if (!legacyTabName) return;
  const meta = await withSheetsRetry(() => sheets.spreadsheets.get({ spreadsheetId: sheetId }), "get(legacyCheck)");
  const legacySheet = meta.data.sheets.find((s) => s.properties.title === legacyTabName);
  if (!legacySheet) return;

  await withSheetsRetry(
    () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: legacySheet.properties.sheetId } }] },
      }),
    "deleteSheet(legacy)"
  );
}

function isRetryableSheetsError(err) {
  const status = err?.response?.status ?? err?.status ?? err?.code;
  return status === 429 || (typeof status === "number" && status >= 500 && status < 600);
}

async function withSheetsRetry(fn, label) {
  return withRetry(fn, {
    retries: 3,
    baseDelayMs: 500,
    isRetryable: isRetryableSheetsError,
    onRetry: (err, attempt, delayMs) =>
      console.warn(`[${new Date().toISOString()}] Sheets API call (${label}) failed (attempt ${attempt}), retrying in ${delayMs}ms: ${err.message}`),
  });
}

async function writeInventoryDrrTable(facilityTables, { sheetId, serviceAccountKeyPath, drrWindowDays, reorderThresholdDays, legacyTabName, syncedAt }) {
  const auth = new google.auth.GoogleAuth({
    keyFile: serviceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await withSheetsRetry(() => sheets.spreadsheets.get({ spreadsheetId: sheetId }), "get(initial)");
  const existingTitles = new Set(meta.data.sheets.map((s) => s.properties.title));

  for (const { facilityCode } of facilityTables) {
    await ensureTabExists(sheets, sheetId, sanitizeTabName(facilityCode), existingTitles);
  }
  await ensureTabExists(sheets, sheetId, SUMMARY_TAB_NAME, existingTitles);

  const metaAfterCreate = await withSheetsRetry(() => sheets.spreadsheets.get({ spreadsheetId: sheetId }), "get(afterCreate)");
  const sheetByTitle = new Map(metaAfterCreate.data.sheets.map((s) => [s.properties.title, s]));

  const bannerRow = buildBannerRow(syncedAt, drrWindowDays);
  const formattingRequests = [];

  for (const [index, facilityTable] of facilityTables.entries()) {
    const { facilityCode, channels, rows } = facilityTable;
    const tabName = sanitizeTabName(facilityCode);
    const header = buildHeader(channels, drrWindowDays);
    const dataRows = rows.map((r) => toSheetRow(r, channels, reorderThresholdDays));
    const values = [bannerRow, header, ...dataRows];

    await withSheetsRetry(() => sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${tabName}!A:ZZ` }), `${tabName}.clear`);
    await withSheetsRetry(
      () =>
        sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tabName}!A1`,
          valueInputOption: "RAW",
          requestBody: { values },
        }),
      `${tabName}.update`
    );

    const sheet = sheetByTitle.get(tabName);
    formattingRequests.push(
      ...buildFormattingRequests({
        sheetId: sheet.properties.sheetId,
        header,
        dataRows,
        existingConditionalFormatCount: (sheet.conditionalFormats || []).length,
        existingBandedRangeIds: (sheet.bandedRanges || []).map((b) => b.bandedRangeId),
        reorderThresholdDays,
        tabColor: tabColorFor(index),
      })
    );
  }

  const summaryHeader = buildSummaryHeader();
  const summaryDataRows = facilityTables.map(buildSummaryRow);
  const summaryValues = [bannerRow, summaryHeader, ...summaryDataRows];
  await withSheetsRetry(() => sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${SUMMARY_TAB_NAME}!A:ZZ` }), "Summary.clear");
  await withSheetsRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${SUMMARY_TAB_NAME}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: summaryValues },
      }),
    "Summary.update"
  );
  const summarySheet = sheetByTitle.get(SUMMARY_TAB_NAME);
  formattingRequests.push(
    ...buildSummaryFormattingRequests({
      sheetId: summarySheet.properties.sheetId,
      header: summaryHeader,
      dataRows: summaryDataRows,
    })
  );

  if (formattingRequests.length > 0) {
    await withSheetsRetry(
      () => sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: formattingRequests } }),
      "batchUpdate(formatting)"
    );
  }

  await deleteLegacyTab(sheets, sheetId, legacyTabName);
}

module.exports = { writeInventoryDrrTable };
