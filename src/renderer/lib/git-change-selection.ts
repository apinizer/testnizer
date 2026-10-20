/**
 * Which changes the Commit panel commits (issue #214, Insomnia Git Sync
 * parity). Pure; the panel holds a `Set` of change keys (`gitChangeKey`).
 *
 * Checking a change also checks what it requires (an added request's new
 * folder); unchecking one also unchecks what requires it. Main closes the
 * selection again on its side — this only keeps what the user SEES equal to
 * what gets committed.
 */
import {
  gitChangeKey,
  withDependentChanges,
  withRequiredChanges,
  type GitChangeItem,
  type GitChangeKind,
} from '../../shared/git-changes'

export function allChangeKeys(items: GitChangeItem[]): Set<string> {
  return new Set(items.map(gitChangeKey))
}

function toggleKeys(selected: Set<string>, keys: string[], items: GitChangeItem[]): Set<string> {
  const allOn = keys.length > 0 && keys.every((k) => selected.has(k))
  const next = new Set(selected)
  if (allOn) {
    for (const k of withDependentChanges(keys, items)) next.delete(k)
  } else {
    for (const k of withRequiredChanges(keys, items)) next.add(k)
  }
  return next
}

/** Flip one change. */
export function toggleChange(
  selected: Set<string>,
  key: string,
  items: GitChangeItem[],
): Set<string> {
  return toggleKeys(selected, [key], items)
}

/** Flip a whole group: all checked → none; otherwise → all (with what they require). */
export function toggleChangeGroup(
  selected: Set<string>,
  kind: GitChangeKind,
  items: GitChangeItem[],
): Set<string> {
  return toggleKeys(selected, items.filter((i) => i.kind === kind).map(gitChangeKey), items)
}

/** Flip everything: all checked → none; otherwise → all. */
export function toggleAllChanges(selected: Set<string>, items: GitChangeItem[]): Set<string> {
  return items.every((i) => selected.has(gitChangeKey(i))) ? new Set() : allChangeKeys(items)
}

export type CheckState = 'all' | 'some' | 'none'

export function checkStateOf(selected: Set<string>, items: GitChangeItem[]): CheckState {
  const on = items.filter((i) => selected.has(gitChangeKey(i))).length
  return on === 0 ? 'none' : on === items.length ? 'all' : 'some'
}

/**
 * The `only` list `git:commit` / `git:push` get: undefined when every change
 * is selected (the plain "commit everything" call, #207 behaviour).
 */
export function selectionForCommit(
  selected: Set<string>,
  items: GitChangeItem[],
): string[] | undefined {
  const keys = items.map(gitChangeKey).filter((k) => selected.has(k))
  return keys.length === items.length ? undefined : keys
}
