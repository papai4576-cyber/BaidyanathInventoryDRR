# Warehouse User Guide — Baidyanath Inventory Sync

This is the guide for the people at the warehouse who just need to click a
button and update the Google Sheet. No coding required.

## What you'll receive

A folder called something like `BaidyanathDRR/` containing three files:

- `BaidyanathDRR.exe` — the app itself
- `config.json` — connection settings (Unicommerce login, Google Sheet ID)
- `service-account.json` — Google credentials

Save the folder anywhere on your PC (Desktop is fine). Do **not** move the
files out of the folder — they need to stay together.

## How to run

1. Open the folder.
2. Double-click **`BaidyanathDRR.exe`**.
3. A black window will open and show progress lines. This takes a few
   minutes depending on how many orders are being pulled.
4. When it finishes you'll see **"Done. The Google Sheet has been
   updated."** Press **Enter** to close the window.
5. Open the Google Sheet — the facility tabs will be refreshed.

## If Windows warns you

The first time you run the app Windows SmartScreen may say *"Windows
protected your PC"*. This happens because the app isn't signed by a big
software vendor. It's safe:

1. Click **More info**
2. Click **Run anyway**

Windows will remember your choice for next time.

## If it fails

The window will show a red **FAILED** line and stay open. Take a screenshot
of the error and send it to the person who gave you the app. Common causes:

- **CONFIG ERROR: config.json not found** — the file was moved or deleted.
  Ask for a fresh copy of the folder.
- **Network / timeout errors** — your internet is down, or Unicommerce is
  blocking this machine's IP. Contact IT.
- **Google Sheet errors** — the service account may not have edit access
  to the sheet. Contact the person who set it up.

## How often to run

Run it whenever you need fresh numbers in the sheet — typically once a
day, early in the morning. It's safe to run multiple times a day.
