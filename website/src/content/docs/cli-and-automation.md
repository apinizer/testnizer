---
title: Collection runner & automation
description: Run collections in sequence, generate HTML reports, schedule recurring runs, and automate from CI.
order: 3
section: Guides
---

> **CLI status:** The standalone `testnizer-cli` package is in active
> development for v1.1. The in-app collection runner and scheduler ship today.

## Collection runner

The collection runner executes a group of requests in sequence — with
environments, variable chaining, and test assertion tracking — without you
clicking Send on each one.

### Starting a run

1. Open a project in the left sidebar
2. Click the **Run** button at the top of the request list (or right-click a
   folder and choose **Run folder**)
3. Configure the run:
   - **Requests** — check or uncheck individual requests to include
   - **Environment** — pick which environment's variables to use
   - **Iterations** — number of times to run the entire sequence (useful for
     load-sampling or data-driven testing)
   - **Delay** — ms pause between requests (avoids hammering rate limits)
   - **Stop on first failure** — halt the run if any test assertion fails
4. Click **Start**

### Variable chaining

Test scripts can write to `pm.environment` (or `pm.collectionVariables`), and
the next request in the sequence picks up the new values. A common pattern:

```
Request 1: POST /login → pm.environment.set('token', response.json().token)
Request 2: GET /me     → uses {{token}} in the Authorization header
Request 3: DELETE /sessions → uses {{token}}
```

This works across folders. Variables written during iteration N are available
in iteration N+1.

### Data-driven runs

Supply a JSON or CSV file of test data in the **Data** section of the runner
configuration. Each row becomes one iteration. Variables from the current row
are added to the environment scope for that iteration:

```json
[
  { "userId": "usr_001", "expectedName": "Alice" },
  { "userId": "usr_002", "expectedName": "Bob" }
]
```

The URL can then reference `{{userId}}` and the test can assert `{{expectedName}}`.

### Run results

While the run is in progress, each request shows a green ✓ or red ✗ badge
as it completes. After the run:

- A **summary bar** shows total pass / fail / error counts and total wall time
- The **per-request detail** panel shows response code, time, and individual
  assertion results

### HTML report export

Click **Export report** after a run to save a standalone HTML file. The report:

- Contains one row per assertion (pass / fail / message)
- Includes request URL, method, response code, response time
- Embeds the full request and response bodies for failed requests
- Has no external dependencies — a single self-contained file you can email,
  attach to a Jira ticket, or commit to a `test-reports/` directory

Reports are also saved in the **History** panel (left sidebar → History tab)
so you can review past runs without re-running.

## Scheduler

The scheduler fires a collection run on a cron schedule while Testnizer is
open.

Open **Tools → Scheduler** (or the Scheduler tab in the footer bar). Click
**Add schedule** and configure:

- **Collection / folder** — what to run
- **Environment** — which variable set to use
- **Cron expression** — standard five-field cron (`0 */6 * * *` = every 6 hours)
- **Enabled / disabled** toggle

The scheduler uses the system clock. If Testnizer is not running when a
scheduled trigger fires, the run is skipped (there is no catch-up execution).

Results appear in History just like manual runs.

## Test suites

Test suites group multiple collections together for a single "integration
suite" run — useful when you want to test a flow that spans multiple
collections (e.g. auth collection → orders collection → billing collection).

Open **Tools → Test Suites** → **New suite** and add collections in the order
you want them to run. Each suite run is recorded as a single history entry
with a combined report.

Supported import formats for test data files: JSON array and CSV (comma
or semicolon separated, UTF-8, with header row).

## CI / unattended runs (v1.1 preview)

`testnizer-cli` will be a separate npm package with a headless runner:

```sh
npx testnizer-cli run ./collections/payments.tns \
  --env staging \
  --iterations 1 \
  --report ./out/payments.html \
  --exit-code-on-failure
```

`--exit-code-on-failure` exits with code 1 when any test assertion fails,
making it usable directly in CI pass/fail logic.

The CLI shares the same engines (HTTP, SOAP, gRPC, WebSocket, SSE) and the
same `pm` API as the desktop app. No UI dependency. No telemetry.

Track progress on the
[releases page](https://github.com/apinizer/testnizer-releases/releases).

## Why not Newman?

Newman runs Postman collections in CI. It works, but it does not speak SOAP,
gRPC, GraphQL subscriptions, SSE, or SoapUI XML collections. And it uses
Postman's hosted scripting model — when scripts call `pm.sendRequest`, the
request goes through Postman's analytics pipeline, not direct to your endpoint.

The Testnizer CLI is built on the same offline-first principle as the app —
no analytics endpoint, no remote config, all crypto and test execution on-device.
