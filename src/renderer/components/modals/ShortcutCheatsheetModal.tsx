// src/renderer/components/modals/ShortcutCheatsheetModal.tsx
// Read-only reference of every global keyboard shortcut. Sourced from
// `command-registry.ts:getShortcutEntries()`, so updates stay in sync with
// the palette + keyboard-shortcuts.ts list.

import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { useUIStore } from '../../stores/ui.store'
import { getShortcutEntries } from '../../lib/command-registry'

export default function ShortcutCheatsheetModal() {
  const { t } = useTranslation()
  const open = useUIStore((s) => s.showShortcutCheatsheet)
  const setOpen = useUIStore((s) => s.setShowShortcutCheatsheet)
  const entries = getShortcutEntries()

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t('command.cheatsheet.title')}
      contentClassName="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <div
        className="overflow-hidden rounded-xl"
        style={{
          width: 'min(520px, 92vw)',
          background: 'var(--white)',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 56px rgba(0,0,0,0.18)',
        }}
      >
        <header
          className="flex items-center justify-between px-4"
          style={{ height: 48, borderBottom: '1px solid var(--border)' }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {t('command.cheatsheet.title')}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1"
            style={{ fontSize: 12, color: 'var(--muted)' }}
            aria-label={t('command.cheatsheet.close')}
          >
            {t('command.cheatsheet.close')}
          </button>
        </header>

        <ul className="divide-y" style={{ maxHeight: 440, overflowY: 'auto' }}>
          {entries.map((entry) => (
            <li
              key={entry.keys + entry.descriptionKey}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <span style={{ fontSize: 13, color: 'var(--text)' }}>{t(entry.descriptionKey)}</span>
              <kbd
                className="rounded px-2 py-0.5"
                style={{
                  fontSize: 12,
                  color: 'var(--accent-text)',
                  background: 'var(--accent-light, #eeecfe)',
                  border: '1px solid var(--border)',
                  fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace",
                }}
              >
                {entry.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
