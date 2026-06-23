// Bound Apps Script for the Inventory DRR Google Sheet. Adds a "Supply Chain Sync" menu
// with a "Sync Now" button that lets non-technical users trigger the existing GitHub
// Actions workflow (.github/workflows/inventory-drr.yml) without touching any code or
// credentials -- this script only fires the trigger; the actual SOAP/Sheets work still
// happens in run.js on GitHub's infrastructure, same as the daily scheduled run.
//
// Setup (one-time, done by an admin -- see README section below):
//   1. Open the Sheet -> Extensions > Apps Script, paste this file's contents in, save.
//   2. Project Settings (gear icon) > Script Properties > add GITHUB_TOKEN with a
//      fine-grained GitHub PAT scoped to ONLY this repo, "Actions: Read and write" permission.
//   3. Reload the Sheet -- a "Supply Chain Sync" menu appears next to Help.

const GITHUB_OWNER = "papai4576-cyber";
const GITHUB_REPO = "BaidyanathInventoryDRR";
const GITHUB_WORKFLOW_FILE = "inventory-drr.yml";
const GITHUB_REF = "master";

// Blocks re-triggering while a sync is almost certainly still running, so an impatient
// double-click (or two people clicking around the same time) doesn't kick off overlapping
// runs that could interleave writes to the same sheet.
const COOLDOWN_MINUTES = 5;

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Supply Chain Sync").addItem("Sync Now", "syncNow").addToUi();
}

function syncNow() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const token = props.getProperty("GITHUB_TOKEN");
  if (!token) {
    ui.alert(
      "Setup needed",
      "No GitHub token is configured yet. An admin needs to add a GITHUB_TOKEN script property -- see the setup instructions in SyncTrigger.gs.",
      ui.ButtonSet.OK
    );
    return;
  }

  const lastTriggeredAt = props.getProperty("LAST_TRIGGERED_AT");
  if (lastTriggeredAt) {
    const minutesSince = (Date.now() - new Date(lastTriggeredAt).getTime()) / 60000;
    if (minutesSince < COOLDOWN_MINUTES) {
      ui.alert(
        "Sync already in progress",
        `A sync was started ${Math.ceil(minutesSince)} minute(s) ago and usually takes 5-10 minutes. ` +
          "Check the 'Last synced' line at the top of each tab -- please wait for it to update before syncing again.",
        ui.ButtonSet.OK
      );
      return;
    }
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    payload: JSON.stringify({ ref: GITHUB_REF }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code === 204) {
    props.setProperty("LAST_TRIGGERED_AT", new Date().toISOString());
    ui.alert(
      "Sync started",
      "The data sync has been triggered. It usually takes 5-10 minutes. " +
        "Check the 'Last synced' line at the top of each tab to see when it's done.",
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      "Couldn't start sync",
      `GitHub responded with an error (code ${code}). Details: ${response.getContentText()}`,
      ui.ButtonSet.OK
    );
  }
}
