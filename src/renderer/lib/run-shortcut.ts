import { formatShortcut } from './shortcut-format'

/**
 * Tooltip of a protocol action button that Ctrl/Cmd+Enter presses: "Send
 * (⌘Enter)" — the chord through the one formatter (issue #257), in the
 * "label (chord)" form every other tooltip uses (MCP Invoke, Footer Console,
 * Save project).
 *
 * Give it to a button ONLY in a state where `run-active-request.ts` does
 * exactly what a click does: Send / Run / Execute while idle (not as Cancel),
 * a realtime Connect while disconnected, Send / Emit / Publish while connected
 * — never Cancel, Disconnect, Unsubscribe or End Streaming, and not while the
 * button is disabled. `tests/renderer/shortcut-tooltips.test.tsx` checks each
 * case against the dispatch.
 */
export function withRunShortcut(label: string): string {
  return `${label} (${formatShortcut(['Mod', 'Enter'])})`
}
