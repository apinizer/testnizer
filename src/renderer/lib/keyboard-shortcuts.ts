// src/renderer/lib/keyboard-shortcuts.ts
// Global keyboard shortcuts for the application

import { useEffect } from 'react'
import { useRequestStore } from '../stores/request.store'
import { useTabsStore } from '../stores/tabs.store'
import { useUIStore } from '../stores/ui.store'

interface ShortcutHandler {
  key: string
  ctrl?: boolean
  shift?: boolean
  action: () => void
  description: string
}

function isMac(): boolean {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0
}

function isModKey(e: KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey
}

function makeTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10)
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Only process when modifier key is held
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
          description: 'Save request',
          action: () => {
            // Save is a no-op stub for now — triggers dirty flag clear
            const activeTabId = useTabsStore.getState().activeTabId
            if (activeTabId) {
              useTabsStore.getState().markDirty(activeTabId, false)
            }
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
            const urlInput = document.querySelector<HTMLInputElement>(
              'input[placeholder*="URL"]'
            )
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
        document.dispatchEvent(new CustomEvent('apinizer:format-body'))
        return
      }

      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase() ||
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
