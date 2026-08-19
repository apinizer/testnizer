/**
 * Right-click menu for the whole renderer (issue #113).
 *
 * Electron ships no default context menu, so a plain input offered nothing at
 * all; inside Monaco the editor's own menu appeared, and its Paste calls
 * `document.execCommand('paste')`, which Chromium refuses in a renderer — the
 * item was visible, clicking it did nothing, and Ctrl/Cmd+V worked the whole
 * time because that takes the native path.
 *
 * So the menu is popped from main (`contextMenu:show`), whose clipboard roles
 * use that same native path. The renderer's only job is to say what was
 * clicked — which it must, because main's own `context-menu` event reports
 * `isEditable: false` for a click on a Monaco `.view-line` div even though the
 * caret is in the editor's hidden textarea.
 */

/** Input types that hold no text and so have nothing to cut, copy or paste. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'button',
  'submit',
  'reset',
  'image',
])

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"], .monaco-editor'

export interface ContextTargetInfo {
  editable: boolean
  hasSelection: boolean
}

function isTextInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type)
}

/**
 * Classify what was right-clicked.
 *
 * `windowSelection` is passed in rather than read here so the decision stays
 * testable; the caller supplies `window.getSelection()?.toString()`.
 */
export function describeContextTarget(
  target: Element | null,
  windowSelection: string,
): ContextTargetInfo {
  const host = target?.closest?.(EDITABLE_SELECTOR) ?? null
  if (!host) {
    return { editable: false, hasSelection: windowSelection.trim().length > 0 }
  }

  if (host instanceof HTMLInputElement && !isTextInput(host)) {
    // A checkbox is not a text field; treat it like ordinary page chrome.
    return { editable: false, hasSelection: windowSelection.trim().length > 0 }
  }

  if (host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement) {
    // A selection inside a form control is not a DOM selection, so
    // `getSelection()` reports nothing — ask the control itself.
    let selected = false
    try {
      selected = host.selectionStart !== host.selectionEnd
    } catch {
      // Some input types throw on selectionStart; fall back to "no selection".
    }
    return { editable: true, hasSelection: selected }
  }

  if (host.classList.contains('monaco-editor')) {
    // Monaco draws its selection instead of making one in the DOM, so there is
    // nothing to inspect from here. Cut/Copy stay enabled: with no selection
    // they act on the current line, which is what every code editor does.
    return { editable: true, hasSelection: true }
  }

  return { editable: true, hasSelection: windowSelection.trim().length > 0 }
}

/**
 * Install the listener. Bubble phase and `defaultPrevented`-aware on purpose:
 * the app's own right-click menus (the endpoint tree, the tab strip) call
 * `preventDefault`, and those must not get a native menu popped on top.
 */
export function installNativeContextMenu(): () => void {
  const handler = (e: MouseEvent): void => {
    if (e.defaultPrevented) return
    const info = describeContextTarget(
      e.target instanceof Element ? e.target : null,
      window.getSelection()?.toString() ?? '',
    )
    void window.api?.contextMenu?.show(info)
  }
  window.addEventListener('contextmenu', handler)
  return () => window.removeEventListener('contextmenu', handler)
}
