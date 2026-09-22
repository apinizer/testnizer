// Open a saved example (issue #125 follow-up) in its own read-only tab.
//
// An example is "what happened on that run": the resolved request plus the
// response that came back. It must never overwrite the live request editor
// (the tab for the owner row keeps its `{{var}}` template), so it gets a
// dedicated `protocol: 'example'` tab that the Workbench renders with
// ExampleView. One tab per example id — reopening focuses the existing one.

import { useTabsStore } from '../stores/tabs.store'
import { switchActiveTab } from './activate-tab'
import type { SavedResponseSummary } from '../types'

export function exampleTabId(savedResponseId: string): string {
  return `example-${savedResponseId}`
}

/** Tab title: `<owner name> · <example name>`, or just the example name. */
export function exampleTabName(exampleName: string, ownerName?: string | null): string {
  return ownerName ? `${ownerName} · ${exampleName}` : exampleName
}

export function openExampleTab(
  item: Pick<SavedResponseSummary, 'id' | 'name' | 'method' | 'url'>,
  ownerName?: string | null,
): void {
  const id = exampleTabId(item.id)
  const tabs = useTabsStore.getState()
  const existing = tabs.tabs.find((t) => t.id === id || t.savedResponseId === item.id)
  if (existing) {
    switchActiveTab(existing.id)
    return
  }
  tabs.openTab({
    id,
    name: exampleTabName(item.name, ownerName),
    protocol: 'example',
    savedResponseId: item.id,
    method: item.method ?? undefined,
    url: item.url ?? undefined,
  })
}
