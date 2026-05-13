// src/renderer/components/shared/CommandPalette.tsx
// Cmd+K command palette. Renders a cmdk-powered search modal that surfaces
// every action exposed by `useCommandActions()`. The cmdk primitives handle
// keyboard navigation (arrows, Enter, Escape) and aria-activedescendant.

import { useMemo } from 'react'
import { Command } from 'cmdk'
import * as Dialog from '@radix-ui/react-dialog'
import { Search } from 'lucide-react'

import {
  useCommandActions,
  type CommandAction,
  type CommandGroup,
} from '../../lib/command-registry'
import { useTranslation } from '../../lib/i18n'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const visuallyHidden = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
}

const GROUP_ORDER: CommandGroup[] = [
  'navigation',
  'request',
  'project',
  'tools',
  'settings',
  'help',
]

const GROUP_LABEL_KEY: Record<CommandGroup, string> = {
  navigation: 'command.group.navigation',
  request: 'command.group.request',
  tools: 'command.group.tools',
  settings: 'command.group.settings',
  project: 'command.group.project',
  help: 'command.group.help',
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation()
  const actions = useCommandActions()

  const grouped = useMemo(() => {
    const map = new Map<CommandGroup, CommandAction[]>()
    for (const a of actions) {
      const list = map.get(a.group) ?? []
      list.push(a)
      map.set(a.group, list)
    }
    return map
  }, [actions])

  const runAction = (action: CommandAction): void => {
    // Close first, then run — keeps subsequent modals (Settings, Save, etc.)
    // from racing with the palette dismissal animation.
    onOpenChange(false)
    setTimeout(() => {
      void action.run()
    }, 0)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0"
          style={{ background: 'rgba(0,0,0,0.4)', zIndex: 9999 }}
        />
        <Dialog.Content
          aria-label={t('command.placeholder')}
          className="fixed left-1/2 top-[18%] -translate-x-1/2"
          style={{ zIndex: 10000, width: 'min(640px, 92vw)' }}
        >
          <Dialog.Title style={visuallyHidden}>{t('command.placeholder')}</Dialog.Title>
          <Dialog.Description style={visuallyHidden}>{t('command.placeholder')}</Dialog.Description>
          <Command
            label={t('command.placeholder')}
            className="overflow-hidden rounded-xl"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--border)',
              boxShadow: '0 24px 56px rgba(0,0,0,0.18)',
            }}
          >
            <div
              className="flex items-center gap-2 px-3"
              style={{ height: 48, borderBottom: '1px solid var(--border)' }}
            >
              <Search size={16} style={{ color: 'var(--muted)' }} aria-hidden />
              <Command.Input
                autoFocus
                placeholder={t('command.placeholder')}
                className="h-full w-full bg-transparent outline-none"
                style={{ fontSize: 14, color: 'var(--text)' }}
              />
            </div>
            <Command.List style={{ maxHeight: 420, overflowY: 'auto', padding: 6 }}>
              <Command.Empty
                className="py-8 text-center"
                style={{ color: 'var(--muted)', fontSize: 13 }}
              >
                {t('command.empty')}
              </Command.Empty>

              {GROUP_ORDER.map((group) => {
                const items = grouped.get(group)
                if (!items || items.length === 0) return null
                return (
                  <Command.Group key={group} heading={t(GROUP_LABEL_KEY[group])} className="mb-1">
                    {items.map((action) => {
                      const Icon = action.icon
                      return (
                        <Command.Item
                          key={action.id}
                          value={`${action.label} ${(action.keywords ?? []).join(' ')}`}
                          onSelect={() => runAction(action)}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2"
                          style={{
                            height: 36,
                            color: 'var(--text)',
                            fontSize: 13,
                          }}
                        >
                          {Icon ? (
                            <Icon size={15} className="shrink-0" />
                          ) : (
                            <span style={{ width: 15 }} aria-hidden />
                          )}
                          <span className="flex-1 truncate">{action.label}</span>
                          {action.shortcut ? (
                            <span
                              className="rounded px-1.5"
                              style={{
                                fontSize: 11,
                                color: 'var(--muted)',
                                border: '1px solid var(--border)',
                                fontFamily:
                                  "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
                              }}
                            >
                              {action.shortcut}
                            </span>
                          ) : null}
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )
              })}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
