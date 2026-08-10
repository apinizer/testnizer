import type { Tab } from '../types'

/**
 * Is this tab a genuinely BLANK scratch tab — the one that should show the
 * protocol picker instead of an editor?
 *
 * Decided by IDENTITY, not by the display name. The Workbench used to test
 * `name === 'New Request' && !url`, so any PERSISTED request that happened to
 * carry that label rendered the picker and appeared to "not open" — issue #69.
 * It looked HTTP-specific only because the APIs tree named its HTTP default
 * exactly `New Request` while every other protocol's default name differed.
 *
 * A tab that points at something stored (endpoint, saved request, test-suite
 * item) is never blank, whatever it is called. The name check is kept as the
 * last condition so a user-created untitled tab that has been given a URL still
 * opens its editor.
 */
export function isBlankScratchTab(
  tab: Pick<Tab, 'name' | 'url' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>,
): boolean {
  if (tab.endpointId || tab.savedRequestId || tab.testSuiteItemId) return false
  if (tab.url) return false
  return tab.name === 'New Request'
}
