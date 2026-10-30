import { useState, useEffect } from 'react'
import { toast } from '../../lib/toast'
import { X } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useUpdaterStore } from '../../stores/updater.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import Modal from '../shared/Modal'
import SettingsAppPasswordSection from './SettingsAppPasswordSection'
import SettingsAppearanceSection, { type AppearanceDraft } from './SettingsAppearanceSection'
import SettingsNetworkSection, { type NetworkDraft } from './SettingsNetworkSection'
import { useSettingsSwitch } from './use-settings-switch'

type SettingsState = AppearanceDraft & NetworkDraft

interface StoredAppSettings {
  defaultTimeout?: number
  sslVerification?: boolean
  followRedirects?: boolean
  proxy?: {
    mode?: string
    host?: string
    port?: number
    auth?: { username?: string; password?: string }
  }
}

function getSettingsApi() {
  return window.api?.settings ?? null
}

/** The stored app settings as draft fields (only what the store holds). */
function fromStore(s: StoredAppSettings): Partial<NetworkDraft> {
  const mode = s.proxy?.mode
  return {
    ...(typeof s.defaultTimeout === 'number' ? { timeout: s.defaultTimeout } : {}),
    ...(typeof s.sslVerification === 'boolean' ? { sslVerification: s.sslVerification } : {}),
    ...(typeof s.followRedirects === 'boolean' ? { followRedirects: s.followRedirects } : {}),
    ...(mode === 'system' || mode === 'none' || mode === 'custom' ? { proxyMode: mode } : {}),
    ...(s.proxy?.host != null ? { proxyHost: s.proxy.host } : {}),
    ...(s.proxy?.port != null ? { proxyPort: String(s.proxy.port) } : {}),
    ...(s.proxy?.auth?.username != null ? { proxyUser: s.proxy.auth.username } : {}),
    ...(s.proxy?.auth?.password != null ? { proxyPassword: s.proxy.auth.password } : {}),
  }
}

/**
 * App settings — the values every project starts from (issue #254: the title
 * says so; the project dialog shows which of them a project overrides). The
 * proxy is a real fallback: a project without its own proxy uses it on Send
 * and Run (`resolveProxy`).
 */
export default function SettingsModal() {
  const show = useUIStore((s) => s.showSettingsModal)
  const setShow = useUIStore((s) => s.setShowSettingsModal)
  const currentTheme = useUIStore((s) => s.theme)
  const currentLocale = useUIStore((s) => s.locale)
  const currentFontSize = useUIStore((s) => s.fontSize)
  const currentFontFamily = useUIStore((s) => s.fontFamily)
  const setTheme = useUIStore((s) => s.setTheme)
  const setLocale = useUIStore((s) => s.setLocale)
  const setFontSize = useUIStore((s) => s.setFontSize)
  const setFontFamily = useUIStore((s) => s.setFontFamily)
  const setShowUpdateModal = useUIStore((s) => s.setShowUpdateModal)
  const setShowAboutModal = useUIStore((s) => s.setShowAboutModal)
  const setShowProjectDetailModal = useUIStore((s) => s.setShowProjectDetailModal)
  const hasActiveProject = useWorkspaceStore(
    (s) => !!s.activeProjectId && s.projects.some((p) => p.id === s.activeProjectId),
  )
  const checkForUpdates = useUpdaterStore((s) => s.check)
  const { t } = useTranslation()

  /** Why the last save failed — keeps the dialog open instead of pretending. */
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Why the stored settings could not be read; the form is showing defaults. */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsState>({
    theme: currentTheme,
    language: currentLocale,
    fontSize: currentFontSize,
    fontFamily: currentFontFamily,
    timeout: 30000,
    sslVerification: true,
    followRedirects: true,
    proxyMode: 'system',
    proxyHost: '',
    proxyPort: '',
    proxyUser: '',
    proxyPassword: '',
  })
  /** What the dialog loaded — the cross-link's unsaved-changes guard compares to it. */
  const [baseline, setBaseline] = useState<SettingsState>(settings)

  // Issue #272: the component stays mounted while closed, so the draft from
  // the previous opening survives. Theme / language / font can change
  // elsewhere in between (command palette, the header) — re-seed them from the
  // store each time the dialog opens, or Save writes the stale values back.
  // Only on the closed → open transition, so a store change while the dialog
  // is open never overwrites the user's draft. (Adjusting state during render
  // on a prop change, as the React docs recommend, instead of in an effect.)
  const [wasShown, setWasShown] = useState(show)
  if (show !== wasShown) {
    setWasShown(show)
    if (show) {
      const seeded: SettingsState = {
        ...settings,
        theme: currentTheme,
        language: currentLocale,
        fontSize: currentFontSize,
        fontFamily: currentFontFamily,
      }
      setSettings(seeded)
      setBaseline(seeded)
    }
  }

  useEffect(() => {
    if (!show) return
    const api = getSettingsApi()
    if (!api?.getAll) return
    api
      .getAll()
      .then((res) => {
        // `{success:false}` is how this bridge REPORTS failure — a thrown
        // rejection is the rarer path. The renderer prefixes the localized
        // sentence, so the detail carried here stays raw.
        if (res && res.success === false) throw new Error(res.error ?? 'unknown error')
        if (!res?.success || !res.data) return
        const patch = fromStore(res.data as StoredAppSettings)
        setSettings((prev) => ({ ...prev, ...patch }))
        setBaseline((prev) => ({ ...prev, ...patch }))
      })
      .catch((e: unknown) => {
        // Not silent: the form would otherwise show DEFAULTS that look like the
        // saved configuration, and pressing Save would write them over it.
        setLoadError(e instanceof Error ? e.message : String(e))
      })
  }, [show])

  const update = (partial: Partial<SettingsState>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }

  /**
   * Persist, THEN close; `true` only when the write landed. A rejected write
   * keeps the dialog open with the reason (it used to close like a success —
   * unacceptable for `sslVerification`).
   */
  const handleSave = async (): Promise<boolean> => {
    setTheme(settings.theme)
    setLocale(settings.language)
    setFontSize(settings.fontSize)
    setFontFamily(settings.fontFamily)
    const api = getSettingsApi()
    if (api?.setAll) {
      try {
        const res = await api.setAll({
          defaultTimeout: settings.timeout,
          sslVerification: settings.sslVerification,
          followRedirects: settings.followRedirects,
          proxy: {
            mode: settings.proxyMode,
            ...(settings.proxyHost ? { host: settings.proxyHost } : {}),
            ...(settings.proxyPort ? { port: Number(settings.proxyPort) } : {}),
            ...(settings.proxyUser
              ? { auth: { username: settings.proxyUser, password: settings.proxyPassword } }
              : {}),
          },
        })
        if (res && res.success === false) throw new Error(res.error ?? t('settings.saveFailed'))
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
        return false
      }
    }
    toast.success(t('settings.saved'))
    setShow(false)
    return true
  }

  const toProject = useSettingsSwitch({
    dirty: JSON.stringify(settings) !== JSON.stringify(baseline),
    target: t('settingsScope.targetProject'),
    save: handleSave,
    discard: () => setSettings(baseline),
    switchTo: () => {
      setShow(false)
      setShowProjectDetailModal(true)
    },
  })

  if (!show) return null

  const handleCheckUpdates = () => {
    setShow(false)
    setShowUpdateModal(true)
    checkForUpdates()
  }

  const title = t('settingsScope.appTitle')
  return (
    <Modal open={show} onOpenChange={setShow} title={title} testId="settings-modal">
      <div className="max-h-[90vh] w-[520px] max-w-[95%] overflow-y-auto rounded-[14px] bg-[var(--white)] p-7 shadow-[var(--shadow-modal)]">
        {/* Header — the scope is in the title (issue #254) */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <span
            data-testid="app-settings-title"
            className="text-[15px] font-bold text-[var(--text)]"
          >
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {hasActiveProject && (
              <button
                type="button"
                data-testid="settings-open-project-settings"
                onClick={toProject.request}
                className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              >
                {t('settingsScope.openProjectSettings')}
              </button>
            )}
            <button
              type="button"
              aria-label={t('a11y.closeDialog')}
              onClick={() => setShow(false)}
              className="cursor-pointer border-none bg-transparent text-[var(--hint)] hover:text-[var(--text)]"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {toProject.dialog}

        <div className="space-y-5">
          <SettingsAppearanceSection value={settings} onChange={update} />
          <SettingsNetworkSection value={settings} onChange={update} />

          {/* Updates: the auto-check / auto-download toggles the updater reads
              live in Project settings → Update (use-auto-updater.ts). The old
              "Auto Update" box here was read by nothing (issue #254). */}
          <div className="flex items-center justify-between gap-3">
            <p data-testid="app-update-per-project-note" className="m-0 text-[var(--hint)]">
              {t('settingsScope.updatePerProject')}
            </p>
            <button
              type="button"
              onClick={handleCheckUpdates}
              className="shrink-0 cursor-pointer rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            >
              {t('settings.checkForUpdates')}
            </button>
          </div>

          {/* App password (issue #240) — applies immediately, not on Save */}
          <SettingsAppPasswordSection />
        </div>

        {(saveError || loadError) && (
          <p role="alert" className="mt-4 mb-0 text-[12px] text-[var(--red)]">
            {saveError ?? `${t('settings.loadFailed')}: ${loadError}`}
          </p>
        )}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between gap-2.5 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={() => {
              setShow(false)
              setShowAboutModal(true)
            }}
            className="cursor-pointer rounded-[7px] border-none bg-transparent px-1 py-1 text-sm text-[var(--muted)] underline-offset-2 hover:underline"
          >
            {t('header.about')}
          </button>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setShow(false)}
              className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-colors hover:opacity-90"
            >
              {t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
