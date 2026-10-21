// Issue #243 — the Socket.IO bearer token's reload from the saved row now goes
// through the shared mechanism of issue #244 (`lib/withheld-credentials.ts`,
// one row read for every store of the tab). Kept as the #243 entry point:
// resolves `false` only when the row could not be read and something is still
// withheld — the caller must then not save the empty field over the token.

import { ensureWithheldCredentialsLoaded } from './withheld-credentials'
import type { Tab } from '../types'

export async function ensureSocketioTokenLoaded(
  tab: Pick<Tab, 'id' | 'protocol' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>,
): Promise<boolean> {
  return (await ensureWithheldCredentialsLoaded(tab)).ok
}
