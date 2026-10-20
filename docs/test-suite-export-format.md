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
