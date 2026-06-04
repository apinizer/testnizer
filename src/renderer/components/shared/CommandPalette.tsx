import { useMemo } from 'react'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'

import {
  useCommandActions,
  GROUP_LABEL_KEY,
  type CommandAction,
  type CommandGroup,
} from '../../lib/command-registry'
import { useTranslation } from '../../lib/i18n'
import { Z } from '../../lib/z-index'
import Modal from './Modal'
import Kbd from './Kbd'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const GROUP_ORDER = Object.keys(GROUP_LABEL_KEY) as CommandGroup[]

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
    // Close first, then schedule the action so Radix can finish unmounting
    // before any second Dialog (Settings, Save, etc.) opens.
    onOpenChange(false)
    queueMicrotask(() => {
      void action.run()
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('command.placeholder')}
      zIndex={Z.COMMAND_PALETTE}
      contentClassName="fixed left-1/2 top-[18%] -translate-x-1/2"
      contentStyle={{ width: 'min(640px, 92vw)' }}
    >
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
                      style={{ height: 36, color: 'var(--text)', fontSize: 13 }}
                    >
                      {Icon ? (
                        <Icon size={15} className="shrink-0" />
                      ) : (
                        <span style={{ width: 15 }} aria-hidden />
                      )}
                      <span className="flex-1 truncate">{action.label}</span>
                      {action.shortcut ? <Kbd>{action.shortcut}</Kbd> : null}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )
          })}
        </Command.List>
      </Command>
    </Modal>
  )
}
