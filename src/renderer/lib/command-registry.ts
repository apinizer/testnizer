// src/renderer/lib/command-registry.ts
// Action registry for the Cmd+K command palette.
//
// Actions are derived dynamically from stores (tools catalog, environments,
// etc) so the palette stays in sync without a manual list to maintain.

import { useMemo } from 'react'
import type { ComponentType } from 'react'
import {
  ArrowLeftRight,
  Boxes,
  FileDown,
  FilePlus2,
  FolderOpen,
  Globe,
  Keyboard,
  Languages,
  Layout,
  Moon,
  PlayCircle,
  Plus,
  Save,
  Send,
  Server,
  Settings as SettingsIcon,
  Sun,
  SunMoon,
  PanelsTopLeft as TabsIcon,
  Wand2,
  X,
} from 'lucide-react'

import { TOOL_CATALOG } from './tools-catalog'
import { useTranslation } from './i18n'
import { useRequestStore } from '../stores/request.store'
import { useTabsStore } from '../stores/tabs.store'
import { useUIStore } from '../stores/ui.store'
import { useEnvironmentStore } from '../stores/environment.store'
import { isMac } from './platform'
import type { ToolProtocol } from '../types'

export type CommandGroup = 'navigation' | 'request' | 'tools' | 'settings' | 'project' | 'help'

export interface CommandAction {
  id: string
  label: string
  shortcut?: string
  group: CommandGroup
  icon?: ComponentType<{ size?: number; className?: string }>
  /** Optional free-text keywords cmdk uses for fuzzy matching. */
  keywords?: string[]
  run: () => void | Promise<void>
}

// Single tab id generator used by every "new tab" action.
function makeTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10)
}

/** Pretty shortcut hint shown in the palette (e.g. "Cmd+K" on macOS, "Ctrl+K" elsewhere). */
export function shortcutLabel(key: string, opts?: { shift?: boolean }): string {
  const mod = isMac() ? 'Cmd' : 'Ctrl'
  const parts: string[] = [mod]
  if (opts?.shift) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/**
 * Build the live action list for the palette. Computed inside a hook so
 * Zustand subscriptions keep dynamic groups (tools, environments) reactive.
 */
export function useCommandActions(): CommandAction[] {
  const { t } = useTranslation()
  const environments = useEnvironmentStore((s) => s.environments)

  return useMemo<CommandAction[]>(() => {
    const tabs = useTabsStore.getState()
    const req = useRequestStore.getState()

    const actions: CommandAction[] = []

    // ── Navigation ───────────────────────────────────────────────────
    actions.push({
      id: 'nav.newTab',
      label: t('command.action.newTab'),
      shortcut: shortcutLabel('T'),
      group: 'navigation',
      icon: Plus,
      keywords: ['tab', 'new', 'create'],
      run: () => {
        tabs.openTab({
          id: makeTabId(),
          name: 'New Request',
          protocol: 'http',
          method: 'GET',
          url: '',
        })
      },
    })
    actions.push({
      id: 'nav.closeTab',
      label: t('command.action.closeTab'),
      shortcut: shortcutLabel('W'),
      group: 'navigation',
      icon: X,
      keywords: ['close', 'tab'],
      run: () => {
        const id = useTabsStore.getState().activeTabId
        if (id) useTabsStore.getState().closeTab(id)
      },
    })
    actions.push({
      id: 'nav.nextTab',
      label: t('command.action.nextTab'),
      group: 'navigation',
      icon: TabsIcon,
      keywords: ['tab', 'next', 'switch'],
      run: () => {
        const s = useTabsStore.getState()
        if (s.tabs.length === 0) return
        const idx = s.tabs.findIndex((tab) => tab.id === s.activeTabId)
        const next = s.tabs[(idx + 1) % s.tabs.length]
        s.setActiveTab(next.id)
      },
    })
    actions.push({
      id: 'nav.prevTab',
      label: t('command.action.prevTab'),
      group: 'navigation',
      icon: TabsIcon,
      keywords: ['tab', 'previous', 'switch'],
      run: () => {
        const s = useTabsStore.getState()
        if (s.tabs.length === 0) return
        const idx = s.tabs.findIndex((tab) => tab.id === s.activeTabId)
        const prev = s.tabs[(idx - 1 + s.tabs.length) % s.tabs.length]
        s.setActiveTab(prev.id)
      },
    })
    actions.push({
      id: 'nav.toggleSidebar',
      label: t('command.action.toggleSidebar'),
      shortcut: shortcutLabel('B'),
      group: 'navigation',
      icon: Layout,
      keywords: ['sidebar', 'panel', 'toggle'],
      run: () => useUIStore.getState().toggleLeftPanel(),
    })

    // ── Request ──────────────────────────────────────────────────────
    actions.push({
      id: 'request.send',
      label: t('command.action.send'),
      shortcut: shortcutLabel('Enter'),
      group: 'request',
      icon: Send,
      keywords: ['send', 'execute', 'request'],
      run: () => req.sendRequest(),
    })
    actions.push({
      id: 'request.save',
      label: t('command.action.save'),
      shortcut: shortcutLabel('S'),
      group: 'request',
      icon: Save,
      keywords: ['save', 'project'],
      run: () => useUIStore.getState().setShowSaveModal(true),
    })
    actions.push({
      id: 'request.formatBody',
      label: t('command.action.formatBody'),
      shortcut: shortcutLabel('F', { shift: true }),
      group: 'request',
      icon: Wand2,
      keywords: ['format', 'pretty', 'body'],
      run: () => {
        document.dispatchEvent(new CustomEvent('testnizer:format-body'))
      },
    })
    actions.push({
      id: 'request.import',
      label: t('command.action.import'),
      shortcut: shortcutLabel('O'),
      group: 'request',
      icon: FileDown,
      keywords: ['import', 'openapi', 'postman', 'curl'],
      run: () => useUIStore.getState().setShowImportModal(true),
    })

    // ── Settings ─────────────────────────────────────────────────────
    actions.push({
      id: 'settings.open',
      label: t('command.action.openSettings'),
      shortcut: shortcutLabel(','),
      group: 'settings',
      icon: SettingsIcon,
      keywords: ['settings', 'preferences'],
      run: () => useUIStore.getState().setShowSettingsModal(true),
    })
    actions.push({
      id: 'settings.theme.light',
      label: t('command.action.themeLight'),
      group: 'settings',
      icon: Sun,
      keywords: ['theme', 'light', 'appearance'],
      run: () => useUIStore.getState().setTheme('light'),
    })
    actions.push({
      id: 'settings.theme.dark',
      label: t('command.action.themeDark'),
      group: 'settings',
      icon: Moon,
      keywords: ['theme', 'dark', 'appearance'],
      run: () => useUIStore.getState().setTheme('dark'),
    })
    actions.push({
      id: 'settings.theme.system',
      label: t('command.action.themeSystem'),
      group: 'settings',
      icon: SunMoon,
      keywords: ['theme', 'system', 'auto'],
      run: () => useUIStore.getState().setTheme('system'),
    })
    actions.push({
      id: 'settings.locale.en',
      label: t('command.action.localeEn'),
      group: 'settings',
      icon: Languages,
      keywords: ['locale', 'language', 'english'],
      run: () => useUIStore.getState().setLocale('en'),
    })
    actions.push({
      id: 'settings.locale.tr',
      label: t('command.action.localeTr'),
      group: 'settings',
      icon: Languages,
      keywords: ['locale', 'language', 'turkish', 'türkçe'],
      run: () => useUIStore.getState().setLocale('tr'),
    })

    // ── Tools ────────────────────────────────────────────────────────
    for (const tool of TOOL_CATALOG) {
      const toolName = t(tool.labelKey)
      actions.push({
        id: `tool.${tool.protocol}`,
        label: t('command.action.openTool').replace('{name}', toolName),
        group: 'tools',
        icon: tool.Icon,
        keywords: ['tool', toolName.toLowerCase()],
        run: () => {
          useTabsStore.getState().openToolTab(tool.protocol as ToolProtocol, toolName)
        },
      })
    }

    // ── Project ──────────────────────────────────────────────────────
    actions.push({
      id: 'project.home',
      label: t('command.action.openProjectHome'),
      group: 'project',
      icon: FolderOpen,
      keywords: ['project', 'home', 'apis'],
      run: () => useUIStore.getState().setActiveSidebarPage('apis'),
    })
    actions.push({
      id: 'project.environments',
      label: t('command.action.openEnvironments'),
      group: 'project',
      icon: Globe,
      keywords: ['environment', 'variables'],
      run: () => useUIStore.getState().setShowEnvironmentModal(true),
    })
    actions.push({
      id: 'project.mocks',
      label: t('command.action.openMocks'),
      group: 'project',
      icon: Server,
      keywords: ['mock', 'server'],
      run: () => useUIStore.getState().setActiveSidebarPage('mocks'),
    })
    actions.push({
      id: 'project.runner',
      label: t('command.action.openRunner'),
      group: 'project',
      icon: PlayCircle,
      keywords: ['runner', 'collection', 'tests'],
      run: () => useUIStore.getState().setShowCollectionRunner(true),
    })
    actions.push({
      id: 'project.newProject',
      label: t('command.action.newProject'),
      group: 'project',
      icon: FilePlus2,
      keywords: ['new', 'project'],
      run: () => useUIStore.getState().setShowNewProjectModal(true),
    })

    // Dynamic: switch active environment
    for (const env of environments) {
      actions.push({
        id: `project.env.${env.id}`,
        label: t('command.action.switchEnvironment').replace('{name}', env.name),
        group: 'project',
        icon: ArrowLeftRight,
        keywords: ['environment', 'switch', env.name.toLowerCase()],
        run: () => {
          void useEnvironmentStore.getState().setActiveEnvironment(env.id)
        },
      })
    }

    // ── Help ─────────────────────────────────────────────────────────
    actions.push({
      id: 'help.shortcuts',
      label: t('command.action.showShortcuts'),
      shortcut: '?',
      group: 'help',
      icon: Keyboard,
      keywords: ['shortcut', 'keyboard', 'help', 'cheatsheet'],
      run: () => useUIStore.getState().setShowShortcutCheatsheet(true),
    })
    actions.push({
      id: 'help.about',
      label: t('command.action.about'),
      group: 'help',
      icon: Boxes,
      keywords: ['about', 'version'],
      run: () => useUIStore.getState().setShowAboutModal(true),
    })

    return actions
    // Re-derive when locale changes (t identity changes) or env list changes.
  }, [t, environments])
}

/** Static shortcut list for the cheatsheet modal — kept in sync with keyboard-shortcuts.ts. */
export interface ShortcutEntry {
  keys: string
  descriptionKey: string
}

export function getShortcutEntries(): ShortcutEntry[] {
  return [
    { keys: shortcutLabel('K'), descriptionKey: 'command.shortcut.palette' },
    { keys: '?', descriptionKey: 'command.shortcut.cheatsheet' },
    { keys: shortcutLabel('Enter'), descriptionKey: 'command.shortcut.send' },
    { keys: shortcutLabel('S'), descriptionKey: 'command.shortcut.save' },
    { keys: shortcutLabel('T'), descriptionKey: 'command.shortcut.newTab' },
    { keys: shortcutLabel('W'), descriptionKey: 'command.shortcut.closeTab' },
    { keys: shortcutLabel('L'), descriptionKey: 'command.shortcut.focusUrl' },
    { keys: shortcutLabel('N'), descriptionKey: 'command.shortcut.newItem' },
    { keys: shortcutLabel('O'), descriptionKey: 'command.shortcut.import' },
    { keys: shortcutLabel('I'), descriptionKey: 'command.shortcut.importCurl' },
    { keys: shortcutLabel('B'), descriptionKey: 'command.shortcut.toggleSidebar' },
    { keys: shortcutLabel(','), descriptionKey: 'command.shortcut.settings' },
    { keys: shortcutLabel('F', { shift: true }), descriptionKey: 'command.shortcut.formatBody' },
  ]
}
