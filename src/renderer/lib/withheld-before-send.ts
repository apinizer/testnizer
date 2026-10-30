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
//
// Every protocol store imports this module, so it imports nothing that needs a
// DOM at load time: the toast / i18n modules pull in `ui.store`, which touches
// `document` (theme) when it loads. They are loaded only when a warning is
// actually shown — the stores stay importable in a node environment (the main
// process tests import `grpc.store` through the engine fixtures).

import { useTabsStore } from '../stores/tabs.store'
import { isWithheldUnder } from './credential-withhold'

async function warnReloadFailed(): Promise<void> {
  try {
    const [{ toast }, { t }] = await Promise.all([import('./toast'), import('./i18n')])
    toast.warning(t('credentials.reloadFailedSend'))
  } catch {
    // No UI to warn in (tests without a DOM): the send still goes.
  }
}

export async function reloadWithheldBeforeSend(): Promise<void> {
  const { activeTabId, tabs } = useTabsStore.getState()
  const tab = tabs.find((x) => x.id === activeTabId)
  if (!tab) return
  try {
    const { ensureWithheldCredentialsLoaded } = await import('./withheld-credentials')
    const reload = await ensureWithheldCredentialsLoaded(tab)
    if (!reload.ok) await warnReloadFailed()
  } catch {
    await warnReloadFailed()
  }
}

/**
 * A copy inside a tab's state — a saved message into the composer, the
 * composer into a saved message (issue #284) — never copies a value that is
 * only blank because the snapshot withheld it. The destination would carry no
 * marker, so the next Ctrl+S would write the blank over the saved value (the
 * issue #259 data-loss class).
 *
 * Nothing withheld at or under `prefix`: `copy` runs at once (synchronously).
 * Otherwise the saved values are reloaded first, the same way a send path
 * does; the copy runs only if the same tab is still live and nothing under
 * `prefix` is still waiting (an unreadable row already warned — copying the
 * blank would hide that the value is missing).
 */
export function afterWithheldReloaded(
  read: () => { withheldCredentials?: readonly string[]; _currentTabId: string | null },
  prefix: string,
  copy: () => void,
): void | Promise<void> {
  const before = read()
  if (!isWithheldUnder(before.withheldCredentials, prefix)) {
    copy()
    return
  }
  const tabId = before._currentTabId
  return reloadWithheldBeforeSend().then(() => {
    const now = read()
    if (now._currentTabId !== tabId || isWithheldUnder(now.withheldCredentials, prefix)) return
    copy()
  })
}
