---
title: Collection runner & automation
description: Run collections in sequence, generate HTML reports, schedule recurring runs, and automate from CI.
order: 3
section: Guides
---

> **CLI status:** there is no standalone command-line runner yet. The in-app
> collection runner and scheduler are what ship today, and a run's report
> exports as HTML or JSON.

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
   - **Environment** — the run uses the project's active environment, and the
     results, run history and reports name it ("No environment" when none)
   - **Iterations** — number of times to run the entire sequence (useful for
     load-sampling or data-driven testing)
   - **Delay between requests** — ms pause between each request
   - **Delay between iterations** — ms pause between whole passes, which is a
     different gap and often the one you actually want
   - **Stop run if an error occurs** — halt the run at the first failure
4. Click **Start**

### Critical requests

Tick **Critical request** in a request's Settings tab (or use the toggle next to
the **Critical** badge on a Flow row of the run sequence) and the run stops when
that request fails or cannot run, whatever *Stop run if an error occurs* says.
Other requests keep going past failures as before, and teardown still runs.
The results, run history and HTML / JSON reports name the critical request that
stopped the run, and critical rows carry a badge. Setup and Teardown rows do
not offer the toggle.

### Setup, Flow and Teardown

Every request in the sequence carries a role, and a folder can carry one for
everything inside it:

| Role | When it runs | Counts toward the verdict |
|---|---|---|
| **Setup** | before the flow | yes |
| **Flow** | the run itself | yes |
| **Teardown** | after the flow, always | no — reported separately |

**Teardown always runs.** Whether the flow finished, stopped on an error, lost
the network, or you pressed Stop, the cleanup still executes. That is the point
of marking something Teardown: the test data you created gets removed even when
the run went wrong.

**A failed Setup step skips the flow.** If the thing the run depends on could
not be created, running the flow against a half-built world produces failures
that mean nothing. The flow is skipped and teardown still runs — and this
happens regardless of the *Stop on first failure* setting, because it is not a
preference, it is what a failed precondition means.

**Teardown cannot rescue or sink a run.** Its results are tallied on their own
line, not in the top-level error count. A cleanup step that fails is worth
seeing, but it does not turn a passing run into a failing one.

**Run-level scripts.** Alongside the per-request roles, the run configuration
has a **Run setup script** and a **Run teardown script**. They execute once per
run — not once per iteration — and the teardown script is guaranteed the same
way teardown requests are: it still runs when the flow stops early. In the
results, script rows carry a **SCRIPT** chip rather than a status code, and a
script that threw is reported as an error. A third slot, **Run fail script**,
runs once after teardown only when the run is red — use it to post the report
(`pm.run.exportHtml()`) to a mail or chat webhook; see
[Run fail script](/docs/scripts#run-fail-script--alert-on-a-red-run).

The **Export HTML** / **Export JSON** buttons on the run results, on every
**All Runs** row and in a scheduled task's history save the run report to a
file — secrets masked, headline counts identical to the screen. A stored run
re-exports without re-running. With several iterations, each result row opens
its own iteration and the HTML report labels every row with its iteration.

A run also keeps its screen when you leave the Runner tab: coming back shows the
progress, the rows so far and **Stop**, and a run that ends while you are
elsewhere shows its results.

### Stopping a run

Two buttons, and they mean different things in every phase:

- **Stop** — end the run, but let cleanup finish. Every teardown request and
  script still executes.
- **Stop now** — halt immediately, abandoning whatever is in flight, cleanup
  included.

Requests that never ran are listed in the results as `NOT_RUN` rather than
being left out, so an interrupted run of twelve steps still shows twelve rows.
They are counted as skipped — neither passed nor failed.

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

### What a run can contain

- **MCP requests** run with the same pass / fail rules and the same `pm.*`
  scripting as Send. A run cannot answer an interactive prompt (a sign-in, a
  question from the server), so such a row fails with a plain message. A stdio
  server starts only if you connected to that exact command from the MCP tab on
  this computer once, so a project pulled from Git cannot make your next run
  execute an unknown program.
- **Scripts** run only in a project you have allowed on this computer. A project
  that arrived from Git, a project file or a script-adding import is blocked until
  you allow it; **Scheduled runs never ask**, their scripted steps fail with a
  message until you allow the project.
- The run uses the same proxy (bypass list and type included), SSL and redirect
  settings as Send.

### Run results

![Collection runner results: 12 of 12 requests passed, with each request's checks listed](/docs/screenshots/runner-results.png)

While the run is in progress, each request shows a green ✓ or red ✗ badge
as it completes. After the run:

- A **summary bar** shows total pass / fail / error counts and total wall time
- The **per-request detail** panel shows response code, time, and individual
  assertion results

### HTML report export

Click **Export HTML** after a run to save a standalone HTML file (**Export
JSON** saves the same run as JSON). The HTML report:

- Contains one row per assertion (pass / fail / message)
- Includes request URL, method, response code, response time
- Embeds the full request and response bodies for failed requests
- Has no external dependencies — a single self-contained file you can email,
  attach to a Jira ticket, or commit to a `test-reports/` directory

Reports are also saved in the **History** panel (left sidebar → History tab)
so you can review past runs without re-running.

## Scheduler

The scheduler fires a run on a schedule while Testnizer is open.

In the Runner configuration choose **Schedule runs** instead of **Run
manually**, pick how often it repeats and click **Schedule run**:

- **Interval** — run every N minutes or hours
- **Daily** — every day at a time you pick
- **Weekly** — chosen weekdays at a time you pick
- **Cron** — a five-field expression (`m h dom mon dow`, for example
  `0 9 * * 1-5`)

All times are your local time. The **Scheduled Tasks** view lists every task with
its upcoming run, schedule, environment and number of endpoints, and lets you
**Run now**, **Pause** / **Resume** or **Delete** it and show its run history.
The environment column names the environment the task uses; if it was deleted
the row says so. A suite and its schedule can both carry a **Run fail script**.

If Testnizer is not running when a scheduled trigger fires, the run is skipped
(there is no catch-up execution). Scheduled runs never ask whether to trust a
project's scripts: a scripted step fails with a message until you have allowed
the project. Results appear in run history just like manual runs, and every row
exports as HTML or JSON.

## Test suites

Test suites group multiple collections together for a single "integration
suite" run — useful when you want to test a flow that spans multiple
collections (e.g. auth collection → orders collection → billing collection).

Add a suite in the **Tests** panel and add requests or collections in the order
you want them to run. A suite runs module by module: for each folder, its own
requests first, then its sub-folders, in the same order as running that folder
from the APIs panel. Run, Quick Run, the Scheduler and the suite exports all use
this order. Folder authentication and pre / post scripts are carried into a suite
built from the APIs panel. Each suite run is recorded as a single history entry
with a combined report.

Supported import formats for test data files: JSON array and CSV (comma
or semicolon separated, UTF-8, with header row).

## Unattended runs and CI

There is no headless command-line runner in 1.6.0. To run without clicking, use
the Scheduler above; to hand results to another system, export the run as JSON
or HTML, or use a **Run fail script** to post the report to a webhook when a
run is red (see [Scripts](/docs/scripts#run-fail-script--alert-on-a-red-run)).
A CLI is on the roadmap but has not shipped.
