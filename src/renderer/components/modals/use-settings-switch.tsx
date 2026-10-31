import { useState, type ReactNode } from 'react'
import SettingsSwitchUnsavedDialog from './SettingsSwitchUnsavedDialog'

/**
 * Issue #254: the cross-link between App settings and Project settings.
 *
 * `request()` switches at once when the origin dialog is clean. With unsaved
 * edits it opens `SettingsSwitchUnsavedDialog` instead:
 *  - Save    → `save()`; switch only when it reports success (a failed save
 *              keeps the user where they are, with its own error shown);
 *  - Discard → `discard()`, then switch (nothing is written);
 *  - Cancel  → close the prompt, the draft stays.
 * `switchTo()` closes the origin dialog and opens the target.
 */
export function useSettingsSwitch({
  dirty,
  target,
  save,
  discard,
  switchTo,
}: {
  dirty: boolean
  /** Translated name of the target dialog, for the prompt text. */
  target: string
  save: () => Promise<boolean>
  discard: () => void
  switchTo: () => void
}): { request: () => void; dialog: ReactNode } {
  const [pending, setPending] = useState(false)
  const [saving, setSaving] = useState(false)

  const request = (): void => {
    if (dirty) setPending(true)
    else switchTo()
  }

  const dialog = (
    <SettingsSwitchUnsavedDialog
      open={pending}
      target={target}
      saving={saving}
      onCancel={() => setPending(false)}
      onDiscard={() => {
        setPending(false)
        discard()
        switchTo()
      }}
      onSave={() => {
        setSaving(true)
        void save()
          .then((ok) => {
            setPending(false)
            if (ok) switchTo()
          })
          .finally(() => setSaving(false))
      }}
    />
  )
  return { request, dialog }
}
