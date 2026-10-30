/**
 * "Would writing this export change the project file?" — the one
 * timestamp-insensitive comparison every git write path uses before it
 * commits: the switch / merge / pull sync and Push (`git.handler`) and the
 * Save dialog's temp-clone pushes (`save:git`, `save:gitPush` — issue #301).
 * Kept out of both handlers because `git.handler` imports `save.handler`.
 */
import { normaliseExportDoc } from './project-changes'
import { stripLocalSecrets } from './local-secrets'

/** Same project content, ignoring the export timestamp and row order. */
export function sameExport(a: string, b: Record<string, unknown>): boolean {
  // Ignores the export timestamp and the per-machine parts of the `project`
  // header (id, workspace, local_path, save_mode…): on machine B the file
  // carries A's id, so comparing the whole header made every switch / merge
  // commit a header-only "Auto-save". Name, display name and description DO
  // count — they travel with the file.
  // Rows are compared without `project_id` / `workspace_id` for the same
  // reason: the importer rebinds them to the local project, so machine B's
  // export of an unchanged collection differs from A's file in every row.
  // Row ORDER is not content either (issue #135). `exportProjectData` lists
  // rows in the local DB's insertion order; a re-import on B inserts the
  // teammate's new rows after B's own, while the merged file lists them in
  // merge order. Compared positionally, B's next switch committed a
  // reorder-only "Auto-save" on the branch it left — local `main` diverged
  // from `origin/main`, neither Pull's fast-forward of the other branches
  // nor the switch's `--ff-only` could move it any more, and after the
  // teammate's next merge B switched to a stale `main`. A collection is a set
  // of rows (see `project-merge.ts`): each section compares as a sorted set
  // of key-order-insensitive rows. A `sort_order` edit is still a change.
  // The normaliser itself lives in `project-changes.ts`, shared with the
  // Commit panel's row diff (issue #207) so the two cannot drift.
  // Both sides go through the SAME JSON round trip: `a` is the parsed file,
  // `b` the live export object. Without it an `undefined` field (dropped by
  // JSON, `null` in `canonical`) or a `Date` / `Buffer` (an ISO string /
  // `{type,data}` once written) compared unequal to its own file and every
  // switch committed a no-op "Auto-save" (issue #154).
  //
  // Values marked secret never reach the file (issue #177), so the live side
  // is compared in its stripped form — otherwise every switch would see a
  // "change" and commit a no-op Auto-save. The FILE side is deliberately not
  // stripped: a file written before #177 still holding a secret compares
  // unequal once, gets rewritten without it, and is equal from then on.
  try {
    const live = JSON.parse(JSON.stringify(stripLocalSecrets(b))) as Record<string, unknown>
    return normaliseExportDoc(JSON.parse(a) as Record<string, unknown>) === normaliseExportDoc(live)
  } catch {
    return false
  }
}
