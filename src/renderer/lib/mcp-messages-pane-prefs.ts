/**
 * Per-user layout of the MCP editor's Messages pane (issue #172): open/closed
 * and height, remembered across tabs and restarts. A UI convenience only, so
 * it lives in localStorage through the try/catch'd helpers — a blocked or
 * corrupt store falls back to the defaults (closed, 240 px).
 */
import { loadJson, saveJson } from './persist-helpers'

export const MESSAGES_PANE_STORAGE_KEY = 'testnizer-mcp-messages-pane'
export const MESSAGES_PANE_DEFAULT_HEIGHT = 240
export const MESSAGES_PANE_MIN_HEIGHT = 120
export const MESSAGES_PANE_MAX_HEIGHT = 600

export interface MessagesPanePrefs {
  open: boolean
  height: number
}

export function clampPaneHeight(h: number): number {
  if (!Number.isFinite(h)) return MESSAGES_PANE_DEFAULT_HEIGHT
  return Math.round(Math.min(MESSAGES_PANE_MAX_HEIGHT, Math.max(MESSAGES_PANE_MIN_HEIGHT, h)))
}

export function loadMessagesPanePrefs(): MessagesPanePrefs {
  const raw = loadJson<Partial<MessagesPanePrefs>>(MESSAGES_PANE_STORAGE_KEY)
  return {
    open: raw?.open === true,
    height:
      typeof raw?.height === 'number' ? clampPaneHeight(raw.height) : MESSAGES_PANE_DEFAULT_HEIGHT,
  }
}

export function saveMessagesPanePrefs(prefs: MessagesPanePrefs): void {
  saveJson(MESSAGES_PANE_STORAGE_KEY, prefs)
}
