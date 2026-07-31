/**
 * The name a project takes as a TRACKED file in the user's git repository.
 *
 * Three call sites wrote this name and two of them disagreed (issue #78):
 *
 *   git.handler  `save:git` → `[^a-zA-Z0-9\-_]` → '-'   →  `sa-l-k.json`
 *   save.handler `save:git` / `save:gitPush` → same class → '_'  →  `sa_l_k.json`
 *
 * That is worse than two files sitting side by side. `save:git` deletes every
 * `.json` in the repo directory that is not the name IT just computed, so the
 * two paths take turns removing each other's copy: push, then save-to-git, and
 * the file that was committed a moment ago is gone from the working tree.
 *
 * One function, one answer. `-` is the convention already used by the path that
 * writes AND prunes, so choosing it means the pruning path keeps finding its own
 * file; the `_` variants are the ones that get cleaned up, which is the intended
 * one-time migration rather than data loss (the project data itself lives in the
 * database — the repo copy is an export).
 *
 * ASCII on purpose. This is not a save-dialog suggestion (`safeFileName`, which
 * preserves Unicode); it names a file that gets committed and then checked out
 * on other machines and CI runners, so it stays inside the portable set.
 */
export function projectFileSlug(name: string | undefined | null): string {
  const raw = (name ?? '').trim()
  const slug = raw.replace(/[^a-zA-Z0-9\-_]/g, '-')
  // A name made entirely of non-ASCII collapses to dashes; fall back rather
  // than commit a file called `----.json`.
  return /[a-zA-Z0-9]/.test(slug) ? slug : 'project'
}

/** `<slug>.json` — the tracked file name for a project export. */
export function projectFileName(name: string | undefined | null): string {
  return `${projectFileSlug(name)}.json`
}
