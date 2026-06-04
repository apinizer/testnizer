/**
 * Tools ↔ SOAP request bridge.
 *
 * Allows the standalone WS-Security tool tab to push its output into the
 * currently-active SOAP request body, and lets the SOAP request panel pre-fill
 * a new WS-Security tool tab with its current payload.
 *
 * Renderer-only state, no IPC.
 */

import { useSoapStore } from '../stores/soap.store'
import { useTabsStore } from '../stores/tabs.store'

let lastSoapTabId: string | null = null
let pendingPayload: string | null = null

export function registerSoapTabActivity(tabId: string): void {
  lastSoapTabId = tabId
}

export function getActiveSoapTabId(): string | null {
  return lastSoapTabId
}

/**
 * Replace the current SOAP request body with the given XML, focus the
 * matching tab, and (when `autoSend` is true) fire the SOAP request so
 * the WS-Security tool feels like a one-click "send" handoff rather
 * than a silent body-injection. Returns true if a target SOAP tab was
 * found.
 */
export function pushPayloadToActiveSoap(xml: string, autoSend = false): boolean {
  const tabsStore = useTabsStore.getState()
  const activeTab = tabsStore.tabs.find((t) => t.id === tabsStore.activeTabId)

  const dispatch = (targetTabId: string): void => {
    // SOAP store is tab-aware — without an explicit `switchToTab(...)`
    // we'd write the rawXml into the *previously-rendered* SOAP tab's
    // slice. The renderer normally calls switchToTab from a useEffect
    // after the active tab changes, but `dispatch()` runs in the same
    // microtask as `setActiveTab`, so the effect hasn't fired yet — we
    // have to flip the slice ourselves first.
    const soap = useSoapStore.getState()
    soap.switchToTab(targetTabId)
    soap.setRawXml(xml)
    if (autoSend) {
      // Fire-and-forget — the SOAP editor surfaces the response in the
      // response pane on its own. Reading sendSoap off the store again
      // (rather than via the captured `soap` ref) picks up any state
      // mutations setRawXml just performed.
      void useSoapStore.getState().sendSoap()
    }
  }

  // Prefer the currently active SOAP tab; fall back to the last-known one.
  if (activeTab?.protocol === 'soap') {
    dispatch(activeTab.id)
    return true
  }

  if (lastSoapTabId) {
    const target = tabsStore.tabs.find((t) => t.id === lastSoapTabId)
    if (target?.protocol === 'soap') {
      tabsStore.setActiveTab(lastSoapTabId)
      dispatch(lastSoapTabId)
      return true
    }
  }

  return false
}

/**
 * Stage a payload for the next-opened WS-Security tool tab to pick up.
 * Used by SOAP request panel's "Open in WS-Security Tool" action.
 */
export function stageWsseToolPayload(xml: string): void {
  pendingPayload = xml
}

/**
 * Consumed by WsSecurityTool on mount. Returns the staged payload (if any) and
 * clears the slot so subsequent tool tabs start clean.
 */
export function consumeStagedWsseToolPayload(): string | null {
  const v = pendingPayload
  pendingPayload = null
  return v
}

/**
 * Open a new WS-Security tool tab pre-filled with the given XML payload.
 */
export function openWsSecurityToolWith(xml: string, label: string): void {
  stageWsseToolPayload(xml)
  useTabsStore.getState().openToolTab('tools.wsSecurity', label)
}
