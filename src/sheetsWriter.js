const { google } = require("googleapis");

const HEADER = [
  "SKU",
  "Channel",
  "Facility",
  "Current Stock",
  `DRR`,
  "Days of Cover",
  "Reorder Flag",
  "Suggested Reorder Qty",
];

function toSheetRow(row) {
  return [
    row.sku,
    row.channelCode,
    row.facilityCode,
    row.currentStock,
    Number(row.drr.toFixed(3)),
    row.daysOfCover === null ? "" : Number(row.daysOfCover.toFixed(1)),
    row.reorderFlag ? "YES" : "",
    row.suggestedReorderQty,
  ];
}

async function ensureTabExists(sheets, sheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === tabName);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
}

async function writeInventoryDrrTable(rows, { sheetId, serviceAccountKeyPath, tabName, drrWindowDays }) {
  const auth = new google.auth.GoogleAuth({
    keyFile: serviceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  await ensureTabExists(sheets, sheetId, tabName);

  const header = HEADER.map((h) => (h === "DRR" ? `DRR (window=${drrWindowDays}d)` : h));
  const values = [header, ...rows.map(toSheetRow)];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${tabName}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

module.exports = { writeInventoryDrrTable };
