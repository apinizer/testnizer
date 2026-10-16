// src/renderer/lib/mock-mcp-save-request.ts
// Global Ctrl/Cmd+S → Mock MCP editor bridge (issue #210 follow-up).
//
// The editor handles Ctrl+S itself while focus is inside it. With focus
// elsewhere (the Workbench tab strip, the tree) only the global shortcut in
// `keyboard-shortcuts.ts` sees the chord; it asks the open editor to run its
// OWN save — blank-default warning included — instead of duplicating that
// flow or falling through to a project / endpoint Save dialog.

const EVENT = 'testnizer:mock-mcp-save'

interface MockMcpSaveDetail {
  serverId: string
}

/** Ask the editor of `serverId` (if mounted) to save, exactly like its Save button. */
export function requestMockMcpSave(serverId: string): void {
  window.dispatchEvent(new CustomEvent<MockMcpSaveDetail>(EVENT, { detail: { serverId } }))
}

/** Subscribe the editor of `serverId`; returns the unsubscribe function. */
export function onMockMcpSaveRequest(serverId: string, handler: () => void): () => void {
  const listener = (e: Event): void => {
    const detail = (e as CustomEvent<MockMcpSaveDetail>).detail
    if (detail?.serverId === serverId) handler()
  }
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
