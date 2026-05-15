// src/renderer/lib/keyboard-shortcuts.ts
// Global keyboard shortcuts for the application

import { useEffect } from 'react'
import { useRequestStore } from '../stores/request.store'
import { useTabsStore } from '../stores/tabs.store'
import { useUIStore } from '../stores/ui.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { isMac } from './platform'
import { makeTabId } from './utils'
import { isToolProtocol } from '../types'

interface ShortcutHandler {
  key: string
  ctrl?: boolean
  shift?: boolean
  action: () => void
  description: string
}

function isModKey(e: KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey
}

function isTypingInEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  // Monaco's editor wraps a contenteditable textarea — closest('.monaco-editor') catches it.
  if (target.closest('.monaco-editor')) return true
  return false
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Cmd/Ctrl+K — command palette. Toggles open/close so power users can dismiss with the same chord.
      if (isModKey(e) && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault()
        const ui = useUIStore.getState()
        ui.setShowCommandPalette(!ui.showCommandPalette)
        return
      }

      // "?" (Shift+/) — shortcut cheatsheet. Disabled when typing in an editable
      // field or when the palette/another modal already owns focus.
      if (
        e.key === '?' &&
        !isModKey(e) &&
        !isTypingInEditableElement(e.target) &&
        !useUIStore.getState().showCommandPalette
      ) {
        e.preventDefault()
        useUIStore.getState().setShowShortcutCheatsheet(true)
        return
      }

      // Only process the rest when modifier key is held.
      if (!isModKey(e)) return

      const shortcuts: ShortcutHandler[] = [
        {
          key: 'Enter',
          ctrl: true,
          description: 'Send request',
          action: () => {
            useRequestStore.getState().sendRequest()
          },
        },
        {
          key: 's',
          ctrl: true,
          description: 'Save endpoint',
          action: () => {
            // Industry-standard Cmd/Ctrl+S = save the active request (Postman,
            // Insomnia, Apidog all do this). Falls back to the project export
            // modal only when there is no editable request tab — e.g. when a
            // Tools tab is active, or no tab at all. Cmd+Shift+S is the
            // dedicated "Save project" chord (see the entry below).
            const ui = useUIStore.getState()
            const tabs = useTabsStore.getState()
            const active = tabs.tabs.find((t) => t.id === tabs.activeTabId)
            // A tab is a request tab if (a) it carries one of the resource ids
            // — endpoint / saved request / mock / test suite item — or (b) its
            // protocol is a regular request protocol. Without the id-based
            // check, freshly-opened "New Request" tabs whose protocol field
            // hadn't propagated yet fell through to the project-save branch
            // (v1.3.1 M8).
            const isRequestTab =
              !!active &&
              (!!active.endpointId ||
                !!active.savedRequestId ||
                !!active.testSuiteItemId ||
                (!isToolProtocol(active.protocol) &&
                  active.protocol !== 'runner' &&
                  active.protocol !== 'mockServer'))
            if (isRequestTab) {
              ui.setShowEndpointSaveModal(true)
            } else {
              ui.setShowSaveModal(true)
            }
          },
        },
        {
          key: 's',
          ctrl: true,
          shift: true,
          description: 'Save project',
          action: () => {
            useUIStore.getState().setShowSaveModal(true)
          },
        },
        {
          key: 't',
          ctrl: true,
          description: 'New tab',
          action: () => {
            const id = makeTabId()
            useTabsStore.getState().openTab({
              id,
              name: 'New Request',
              protocol: 'http',
              method: 'GET',
              url: '',
            })
          },
        },
        {
          key: 'p',
          ctrl: true,
          description: 'Open Project Hub',
          action: () => {
            // v1.3.1 B1: project switching moved to the Project Hub on Home,
            // but there was no keyboard path to get there. Cmd/Ctrl+P now
            // unmounts the current project and renders the hub.
            useWorkspaceStore.getState().goHome()
          },
        },
        {
          key: 'w',
          ctrl: true,
          description: 'Close tab',
          action: () => {
            const activeTabId = useTabsStore.getState().activeTabId
            if (activeTabId) {
              useTabsStore.getState().closeTab(activeTabId)
            }
          },
        },
        {
          key: 'l',
          ctrl: true,
          description: 'Focus URL input',
          action: () => {
            const urlInput = document.querySelector<HTMLInputElement>('input[placeholder*="URL"]')
            urlInput?.focus()
            urlInput?.select()
          },
        },
        {
          key: 'n',
          ctrl: true,
          description: 'New item',
          action: () => {
            const id = makeTabId()
            useTabsStore.getState().openTab({
              id,
              name: 'New Request',
              protocol: 'http',
              method: 'GET',
              url: '',
            })
          },
        },
        {
          key: 'o',
          ctrl: true,
          description: 'Import',
          action: () => {
            useUIStore.getState().setShowImportModal(true)
          },
        },
        {
          key: 'i',
          ctrl: true,
          description: 'Import cURL',
          action: () => {
            useUIStore.getState().setShowImportModal(true)
          },
        },
        {
          key: 'b',
          ctrl: true,
          description: 'Toggle sidebar',
          action: () => {
            useUIStore.getState().toggleLeftPanel()
          },
        },
        {
          key: ',',
          ctrl: true,
          description: 'Settings',
          action: () => {
            useUIStore.getState().setShowSettingsModal(true)
          },
        },
      ]

      // Shift+F shortcut (format body)
      if (e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        // Trigger Monaco editor format — dispatches a custom event
        document.dispatchEvent(new CustomEvent('testnizer:format-body'))
        return
      }

      for (const shortcut of shortcuts) {
        const keyMatch =
          e.key.toLowerCase() === shortcut.key.toLowerCase() ||
          (shortcut.key === 'Enter' && e.key === 'Enter')

        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey

        if (keyMatch && shiftMatch) {
          e.preventDefault()
          shortcut.action()
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
