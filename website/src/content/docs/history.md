---
title: Request history
description: Browse, replay, and export past requests from Testnizer's local history panel.
order: 4
section: Reference
---

## What's recorded

Every request you send is recorded automatically. If you prefer not to log a session, disable recording under **Settings → History → Don't record**.

Each history entry captures:

- **Timestamp** — exact date and time the request was sent.
- **Method and URL** — with all environment variables already resolved.
- **Status code, response time, and response size.**
- **Request headers and body** — secrets matched against environment variables are masked before storage.
- **Response headers and body.**
- **Test assertion results** — which assertions passed and which failed.
- **Project and branch** — so you can filter history by context, not just by URL.

---

## Browsing history

Open the **History** tab in the left sidebar, or press `Ctrl+H` (Windows/Linux) / `Cmd+H` (macOS).

The list is sorted with the most recent entry at the top.

Filtering options:

- **Search** — match against URL fragment or status code.
- **Filter by project** — show only requests made within a specific project.
- **Filter by date range** — narrow down to a time window.

Click any entry to load the full request and response detail in the right panel.

---

## Replaying a request

Click a history entry, then click **Open in editor**. The request editor opens with the original method, URL, headers, and body pre-filled.

You can send it as-is or modify any field before sending. The replay behaves identically to a manually constructed request — pre-request scripts run, tests execute, and the result is saved as a new history entry.

**Collection runner results** also appear in history. Each runner execution is stored as a single top-level entry. Expand it to see the individual request results for every endpoint that was part of the run.

---

## Exporting history

Select one entry or a range of entries, then choose **Export** from the context menu.

Available formats:

| Format | Use case |
|---|---|
| **HAR (HTTP Archive)** | Compatible with browser DevTools and performance analysis tools such as WebPageTest and Charles Proxy. |
| **Testnizer JSON** | Import the entries into another Testnizer instance. Useful for sharing reproduction cases with teammates. |
| **cURL commands** | Paste directly into a terminal to replay requests without opening the application. |

---

## Privacy and retention

History is stored exclusively in the local SQLite database (`data.db`) on your machine. Nothing is transmitted over the network.

**Default retention:** the last 1,000 entries. Older entries are pruned automatically.

To adjust retention, go to **Settings → History → Retention**. The range is 100 entries to unlimited.

If you select **Unlimited**, `data.db` will grow over time. Projects that send large response bodies — binary files, bulk data exports — can produce a notably large database. Monitor disk usage if this applies to your workflow.

**Manual purge options:**

- **Settings → History → Clear all** — deletes the entire history log.
- **Settings → History → Delete before date** — removes entries older than a date you specify, leaving recent history intact.

Neither action affects your saved endpoints, environments, or collection structure.
