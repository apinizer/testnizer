# Test Suite export format (`kind: "testSuite"`)

Testnizer's native suite export (Tests → suite → Export → Testnizer JSON).

```jsonc
{
  "version": "2.0.0",
  "kind": "testSuite",
  "execution_model": "…",          // the rule below, in one sentence
  "suite":   { "id", "name", "description", "run_config", … },
  "folders": [ { "id", "parent_id", "name", "sort_order", "auth", "pre_script", "post_script", "path" } ],
  "items":   [ { "id", "folder_id", "name", "method", "url", "request_schema", "assertions",
                 "sort_order", "execution_order", "folder_path" } ]
}
```

## Execution order

- `sort_order` is a **sibling index inside one folder** (`items[].folder_id`,
  `folders[].parent_id`). Two folders each have their own 0, 1, 2… It is
  **not** a global order.
- A suite runs as a **depth-first walk** of its tree. At every level, the
  suite root included, the level's own requests run first by `sort_order`.
  Then each child folder runs, whole, by `sort_order`. This is the order
  the APIs folder Run uses, and the order the Runner sequence numbers its
  rows in.
- `items[]` is written in that order, and `items[].execution_order` is the
  item's 0-based global index (0 … N-1). A reader that wants the run order
  sorts by `execution_order`.
- `folders[]` is written parents-first, so a reader can insert the rows in
  file order. `path` and `folder_path` are the `" / "`-joined folder names
  from the suite root.

On import, a file whose items all carry `execution_order` is authoritative:
items are sorted by it and `sort_order` is renumbered per folder from it.
Files without it (written before 1.5.5) keep their per-folder `sort_order`.

The single implementation is `src/shared/suite-order.ts`. Run, Quick Run,
Scheduler, the Tests sidebar and every suite export (Testnizer, Postman,
Insomnia) use it.

- Postman: each level lists its requests, then its subfolders, because
  Postman and Newman run in array order.
- Insomnia: every folder and request gets a `metaSortKey` in execution
  order, because Insomnia orders siblings by that key.

## Run configuration (`suite.run_config`)

`run_config` is the suite's saved Runner configuration (issue #100), stored
verbatim as a JSON string and carried by project export / git like the rest
of the suite:

```jsonc
{
  "version": 1,
  "items": [ { "id", "selected", "phase"? } ],   // phase: "setup" | "teardown"; omitted = flow
  "delay", "iterationDelay", "iterations",
  "stopOnError", "persistResponses", "keepVariableValues",
  "environmentId"?,
  "runPreScript"?,    // once, before the setup requests
  "runPostScript"?,   // once, after teardown — even when the run stopped early
  "runFailScript"?    // once, after teardown + runPostScript, only when the run is red (issue #267)
}
```

Blank scripts are omitted; a reader that does not know a key ignores it, and
a config written by an older build simply has no `runFailScript`.

The scripts are plain text in the file. A fail script that calls a mail or
chat webhook should reference the key as `{{secretVar}}` (a secret
environment or project variable) rather than paste it — secret values stay on
this machine, the script does not.

## Folder auth and scripts

`folders[].auth`, `pre_script` and `post_script` travel with the folder. They
cascade at run time in this order: project, then folder(s), then request.
The Postman and Insomnia suite exports carry them as folder `auth`/`event`
and `authentication`/`preRequestScript`/`afterResponseScript`.

## Ids on import

Suite, folder and item ids are re-minted on import, so an export can be
imported back into the same project. `source_endpoint_id` is advisory and
is dropped. Items are self-contained request snapshots, so nothing is
re-pointed at the target project's endpoints. If a foreign key still cannot
be satisfied, for example a corrupted `parent_id` cycle, the error names the
table, the row and its references. A bare `FOREIGN KEY constraint failed`
is never shown.

## Scripts and Tests on Postman/Insomnia export

This applies to the project export and the suite export alike (issue #270).
The aim is that a collection runs in Postman, Newman or Insomnia with the
same checks it runs with here.

| Testnizer | Postman v2.1 | Insomnia v4 |
|---|---|---|
| Project pre-request / test script (`projects.shared_settings`) | collection `event` (`prerequest` / `test`) | not carried: Testnizer's Insomnia importers read no workspace-level script |
| Folder auth, pre-request script, post-response script | folder `auth`, `event` | `request_group` `authentication`, `preRequestScript`, `afterResponseScript` |
| Request pre-request script | item `event` `prerequest` | `preRequestScript` |
| Request post-response script | item `event` `test` | `afterResponseScript` |
| Tests-tab assertion rows | generated `pm.test` code at the top of the item's `test` script, plus `x-apinizer.assertions` for the four kinds Apinizer carries | generated `insomnia.test` code at the top of `afterResponseScript` |

The generated code sits between two marker lines, ahead of the request's
own script, because Testnizer runs the rows before that script:

```js
// --- Testnizer Tests tab assertions (generated) ---
;(function () {
// tn-assert:status_equals
pm.test("Status is 200", function () { … });
})();
// --- end Testnizer Tests tab assertions ---
```

- Every row computes the same verdict as the Tests tab on Send:
  - Header names are matched without regard to case, and values are trimmed.
  - JSON equality compares `JSON.stringify` output, so key order matters.
  - A JSONPath row with no expected value only checks that the path exists.
  - `{{var}}` is resolved with `pm.variables.replaceIn`.
- The code uses only plain JavaScript and pm calls that Postman, Insomnia
  and Testnizer's own script runtime all provide. JSONPath is evaluated by an
  inlined copy of Testnizer's evaluator.
- Disabled rows are not exported.
- `body_xpath` rows, and any kind this build doesn't know, become a
  `// … not exportable` comment and are never dropped silently. Postman and
  Insomnia scripts have no XPath engine. The XPath row still travels in
  `x-apinizer`.
- The single implementation is `src/shared/assertions-to-script.ts`.

**On import** (Postman), when an item carries `x-apinizer` assertions:

1. Those assertions come back as Tests-tab rows (`status_equals`,
   `body_contains`/`body_equals_json`, `body_jsonpath`, `body_xpath`).
2. Their generated lines are removed from the test script, so no check runs
   twice.
3. Generated tests of the other kinds (headers, status range, time and size)
   stay in the script. They run there with the same verdict.

Without `x-apinizer`, for example in an Insomnia file, the whole block stays
as script.

A collection-level `event` fills the project's pre-request / test script
only when that script is empty. A collection imported into a folder leaves
the project's scripts alone. Each case that is not applied is reported as an
import warning.
