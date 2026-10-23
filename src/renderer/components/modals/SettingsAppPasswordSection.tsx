import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../stores/auth.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { ChangePasswordForm, DisablePasswordForm } from '../auth/AppPasswordForms'
import SetPasswordForm from '../auth/SetPasswordForm'
import { SecretStorageUnencryptedNote } from '../shared/SecretStorageNotes'

/**
 * Settings → App password (issue #240). Turning the password off used to be
 * reachable only from the Profile dialog, which opens only from the Project
 * Home avatar. This section shows the status and drives the same forms and
 * store actions as Profile. The actions apply immediately — they are not part
 * of the Settings dialog's Save. Turning the password off keeps the current
 * session; later launches open straight into the app. Setting one is an
 * inline form too (review #13) — it used to sign out to the start screen
 * without warning; now the session continues and the next launch asks.
 */
type Mode = 'idle' | 'set' | 'change' | 'disable'

const GHOST_BTN_CLS =
  'cursor-pointer rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--text)] transition-colors hover:bg-[var(--bg)]'

export default function SettingsAppPasswordSection() {
  const { t } = useTranslation()
  const hasPasswordSet = useAuthStore((s) => s.hasPasswordSet)
  const isGuest = useAuthStore((s) => s.isGuest)
  const user = useAuthStore((s) => s.user)
  // The header session menu opens Settings straight at the Set form.
  const [mode, setMode] = useState<Mode>(() =>
    useUIStore.getState().settingsFocus === 'appPasswordSet' && hasPasswordSet === false
      ? 'set'
      : 'idle',
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const changeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const focus = useUIStore.getState().settingsFocus
    if (focus !== 'appPasswordSet' && focus !== 'appPassword') return
    useUIStore.setState({ settingsFocus: null })
    rootRef.current?.scrollIntoView?.({ block: 'nearest' })
    // "Manage password…" (issue #268): no form opens; keyboard focus lands on
    // Change so the next step is one key away.
    if (focus === 'appPassword') changeRef.current?.focus()
  }, [])

  // null = not checked yet: say so instead of guessing "off".
  const state: 'on' | 'off' | 'unknown' =
    hasPasswordSet === null ? 'unknown' : hasPasswordSet ? 'on' : 'off'
  // change/disable need the signed-in local user (the store refuses without one).
  const canManage = state === 'on' && !!user && !isGuest

  const statusText =
    state === 'on'
      ? t('settings.appPasswordOn')
      : state === 'off'
        ? t('settings.appPasswordOff')
        : t('settings.appPasswordUnknown')

  return (
    <div ref={rootRef} data-testid="settings-app-password">
      <div className="mb-1.5 font-medium text-[var(--muted)]">{t('settings.appPassword')}</div>
      <div className="flex items-center justify-between gap-3">
        <span
          data-testid="settings-app-password-status"
          data-state={state}
          className="text-[var(--text)]"
        >
          {statusText}
        </span>
        {mode === 'idle' && (
          <div className="flex shrink-0 gap-2">
            {canManage && (
              <>
                <button
                  ref={changeRef}
                  type="button"
                  data-testid="settings-app-password-change"
                  onClick={() => setMode('change')}
                  className={GHOST_BTN_CLS}
                >
                  {t('settings.appPasswordChange')}
                </button>
                <button
                  type="button"
                  data-testid="settings-app-password-disable"
                  onClick={() => setMode('disable')}
                  className="cursor-pointer rounded-[7px] border border-[var(--red)] bg-[var(--white)] px-2.5 py-1 text-[var(--red)] transition-colors hover:bg-[var(--bg)]"
                >
                  {t('settings.appPasswordDisable')}
                </button>
              </>
            )}
            {state === 'off' && (
              <button
                type="button"
                data-testid="settings-app-password-set"
                onClick={() => setMode('set')}
                className={GHOST_BTN_CLS}
              >
                {t('userMenu.setPassword')}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-1 text-[var(--muted)]" style={{ fontSize: 12 }}>
        {t('settings.appPasswordHint')}
      </div>
      {/* Issue #239: the app password does not encrypt data; secrets use the OS keychain. */}
      <SecretStorageUnencryptedNote className="mt-1" />

      {mode !== 'idle' && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
          {mode === 'set' ? (
            <SetPasswordForm onCancel={() => setMode('idle')} onDone={() => setMode('idle')} />
          ) : mode === 'change' ? (
            <ChangePasswordForm
              onCancel={() => setMode('idle')}
              onChanged={() => setMode('idle')}
            />
          ) : (
            <DisablePasswordForm
              onCancel={() => setMode('idle')}
              // The session continues password-less (auth.store), so Settings
              // stays open and the status row flips to "Off".
              onDisabled={() => setMode('idle')}
            />
          )}
        </div>
      )}
    </div>
  )
}
