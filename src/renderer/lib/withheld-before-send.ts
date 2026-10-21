// Issue #244 — Send / Connect never go out with a withheld credential.
//
// After a restart the tab's literal credentials are blank until the
// Workbench's background reload (`lib/withheld-credentials.ts`) has read them
// back from the saved row. A Send / Connect pressed in that window would ship
// the empty fields and the user would see a 401. Every send path whose own
// slice still carries a withheld marker awaits the reload first.
//
// The reload module imports every protocol store, so the stores cannot import
// it statically; it is loaded here with a dynamic import. A row that cannot
// be read does not block the send — the request goes out with the empty
// fields, and a warning says so.

import { useTabsStore } from '../stores/tabs.store'
import { toast } from './toast'
import { t } from './i18n'

export async function reloadWithheldBeforeSend(): Promise<void> {
  const { activeTabId, tabs } = useTabsStore.getState()
  const tab = tabs.find((x) => x.id === activeTabId)
  if (!tab) return
  try {
    const { ensureWithheldCredentialsLoaded } = await import('./withheld-credentials')
    const reload = await ensureWithheldCredentialsLoaded(tab)
    if (!reload.ok) toast.warning(t('credentials.reloadFailedSend'))
  } catch {
    toast.warning(t('credentials.reloadFailedSend'))
  }
}
