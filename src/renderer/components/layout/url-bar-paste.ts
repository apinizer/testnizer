/**
 * The HTTP URL bar's paste handler (issue #278). The `<input>` would strip
 * the newlines of a multi-line command, so the text is read from the
 * clipboard event itself. A cURL command (any of the three shells) replaces
 * the request and shows `CurlPasteToast` with Undo + the parser's notes; any
 * other text (a plain URL…) is left to the browser's normal paste.
 */
import { createElement, type ClipboardEvent } from 'react'
import { useTabsStore } from '../../stores/tabs.store'
import { applyCurlPaste, isHttpEditorTab } from '../../lib/curl-paste'
import { toast } from '../../lib/toast'
import { t } from '../../lib/i18n'
import { looksLikeCurl } from '../../../shared/curl'
import CurlPasteToast from './CurlPasteToast'

const TOAST_ID = 'curl-paste'
const TOAST_MS = 8_000
const TOAST_WITH_NOTES_MS = 14_000

export function handleUrlBarPaste(e: ClipboardEvent<HTMLInputElement>): void {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!looksLikeCurl(text)) return
  const tabs = useTabsStore.getState()
  const tab = tabs.tabs.find((x) => x.id === tabs.activeTabId)
  if (!isHttpEditorTab(tab)) return
  e.preventDefault()
  // Editing a preview tab pins it, exactly like typing into the URL bar.
  if (tab?.isPreview) tabs.pinTab(tab.id)

  const res = applyCurlPaste(text)
  if (res.status === 'no-url') {
    toast.error(t('curlPaste.noUrl'))
    return
  }
  if (res.status !== 'applied') return
  // One id: a second paste REPLACES the first toast, so no stale Undo (which
  // would roll back past the newer paste) is left on screen.
  toast.custom(
    () =>
      createElement(CurlPasteToast, {
        dialect: res.dialect,
        warnings: res.warnings,
        onUndo: () => {
          const restored = res.undo()
          toast.dismiss(TOAST_ID)
          if (restored) toast.info(t('curlPaste.undone'))
          else toast.warning(t('curlPaste.undoUnavailable'))
        },
        onClose: () => toast.dismiss(TOAST_ID),
      }),
    { id: TOAST_ID, duration: res.warnings.length > 0 ? TOAST_WITH_NOTES_MS : TOAST_MS },
  )
}
