# Sync Now button (Google Apps Script)

Lets non-technical users trigger a data sync directly from the Google Sheet's menu bar, instead of needing GitHub access. One-time setup by an admin; after that, anyone with edit access to the Sheet can click the button.

## What it does

Adds a **Supply Chain Sync > Sync Now** menu to the spreadsheet. Clicking it fires the same `workflow_dispatch` trigger that GitHub Actions already exposes for `.github/workflows/inventory-drr.yml` — no new infrastructure, no duplicated sync logic. The actual SOAP pulls and Sheet writes still happen in `run.js`, on GitHub's servers, the same as the daily scheduled run. A 5-minute cooldown prevents accidental double-triggering (e.g. two people clicking around the same time).

## One-time setup

1. **Generate a GitHub token** scoped as narrowly as possible:
   - Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens) and create a **fine-grained** personal access token.
   - Resource owner: your account. Repository access: **Only select repositories** → `BaidyanathInventoryDRR`.
   - Permissions: **Actions → Read and write**. Nothing else needed.
   - Set an expiration you're comfortable with (you'll need to repeat this setup when it expires).
   - Copy the generated token (starts with `github_pat_...`) — you won't see it again.

2. **Add the script to the Sheet:**
   - Open the Google Sheet → **Extensions → Apps Script**.
   - Delete any placeholder code, paste in the contents of [`SyncTrigger.gs`](./SyncTrigger.gs).
   - Save (the floppy-disk icon or Ctrl+S). Name the project anything (e.g. "Sync Trigger").

3. **Store the token as a Script Property (not in the code):**
   - In the Apps Script editor, click **Project Settings** (gear icon, left sidebar).
   - Scroll to **Script Properties** → **Add script property**.
   - Property: `GITHUB_TOKEN`. Value: paste the token from step 1.
   - Save.

4. **Reload the Google Sheet tab.** A new **Supply Chain Sync** menu appears next to **Help**. The first click will prompt for Google account authorization (one-time, since the script makes an external request) — approve it.

## For your supply chain team

Nothing to install. Open the Sheet → **Supply Chain Sync → Sync Now**. A confirmation popup explains it takes 5-10 minutes and to watch the "Last synced" line at the top of each tab.

## If the token expires or is revoked

Repeat step 1 and step 3 only (the script itself doesn't need to change).
