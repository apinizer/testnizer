/**
 * What the bound row STORES for a tab's auth credentials (issue #261).
 *
 * The restart hint under Auth ("…lost after a restart unless the request is
 * saved", issue #244) misled once the request was saved with that literal
 * value. It is now hidden only while every literal credential of the active
 * auth type equals the value the tab's bound row holds.
 *
 * MEMORY ONLY: the values are literal secrets, so they are never written to a
 * tab snapshot or localStorage (that would bring back the issue #244 leak).
 * Recorded where the row's content is known for certain:
 *   - a successful in-place save (`saveActiveRequestInPlace`) and Save As,
 *   - a row read (`ensureWithheldCredentialsLoaded`, and `loadStoredAuthFromRow`
 *     whenever the Auth tab shows a tab / binding — so a row changed elsewhere
 *     (git pull, another tab) is not trusted from an old record).
 * An entry belongs to one binding (suite item / saved request / endpoint):
 * after the tab is rebound or orphaned it no longer counts.
 */
import { create } from 'zustand'
import type { Tab } from '../types'
import { authCredentialValues, type CredentialSpec } from './credential-withhold'

type BoundTab = Pick<Tab, 'id' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>

interface Entry {
  binding: string
  values: Record<string, string>
}

interface StoredAuthState {
  byTab: Record<string, Entry>
}

/** Not persisted — no `persist` middleware, no snapshot. */
export const useStoredAuthStore = create<StoredAuthState>(() => ({ byTab: {} }))

/** Bumped on every record / forget: a row read started earlier must not overwrite a newer record. */
const versions = new Map<string, number>()
const bump = (tabId: string): void => {
  versions.set(tabId, (versions.get(tabId) ?? 0) + 1)
}
export function storedAuthVersion(tabId: string): number {
  return versions.get(tabId) ?? 0
}

/** The row a tab saves to, same precedence as the in-place save: suite item, saved request, endpoint. */
export function bindingKey(tab: Omit<BoundTab, 'id'> | undefined): string | null {
  if (!tab) return null
  if (tab.testSuiteItemId) return `item:${tab.testSuiteItemId}`
  if (tab.savedRequestId) return `saved:${tab.savedRequestId}`
  if (tab.endpointId) return `endpoint:${tab.endpointId}`
  return null
}

/** Remember that `tab`'s bound row stores `auth` (its credential fields). */
export function recordStoredAuth(tab: BoundTab, auth: unknown, spec: CredentialSpec): void {
  const binding = bindingKey(tab)
  if (!binding) return
  const values = authCredentialValues(auth, spec)
  bump(tab.id)
  useStoredAuthStore.setState((s) => ({ byTab: { ...s.byTab, [tab.id]: { binding, values } } }))
}

export function forgetStoredAuth(tabId: string): void {
  bump(tabId)
  if (!(tabId in useStoredAuthStore.getState().byTab)) return
  useStoredAuthStore.setState((s) => {
    const byTab = { ...s.byTab }
    delete byTab[tabId]
    return { byTab }
  })
}

/** The stored values for `tab`'s CURRENT binding, or undefined when unknown. */
export function storedAuthValues(
  byTab: Record<string, Entry>,
  tab: BoundTab | undefined,
): Record<string, string> | undefined {
  if (!tab) return undefined
  const entry = byTab[tab.id]
  const binding = bindingKey(tab)
  return entry && binding && entry.binding === binding ? entry.values : undefined
}

/**
 * Every literal credential equals what the row stores. False when nothing is
 * known about the row (unsaved draft, unread / missing row).
 */
export function literalsMatchStored(
  literals: ReadonlyArray<[string, string]>,
  stored: Record<string, string> | undefined,
): boolean {
  if (!stored) return false
  return literals.every(([path, value]) => stored[path] === value)
}
