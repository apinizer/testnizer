import { useState, useEffect, useId } from 'react'
import { toast } from '../../lib/toast'
import { X } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useUpdaterStore } from '../../stores/updater.store'
import { useTranslation } from '../../lib/i18n'
import Modal from '../shared/Modal'
import type { Theme, Language } from '../../types'

interface SettingsState {
  theme: Theme
  language: Language
  fontSize: number
  timeout: number
  sslVerification: boolean
  autoUpdate: boolean
  proxyMode: 'system' | 'none' | 'custom'
  proxyHost: string
  proxyPort: string
}

function getSettingsApi() {
  return window.api?.settings ?? null
}

export default function SettingsModal() {
  const show = useUIStore((s) => s.showSettingsModal)
  const setShow = useUIStore((s) => s.setShowSettingsModal)
  const currentTheme = useUIStore((s) => s.theme)
  const currentLocale = useUIStore((s) => s.locale)
  const currentFontSize = useUIStore((s) => s.fontSize)
  const setTheme = useUIStore((s) => s.setTheme)
  const setLocale = useUIStore((s) => s.setLocale)
  const setFontSize = useUIStore((s) => s.setFontSize)
  const setShowUpdateModal = useUIStore((s) => s.setShowUpdateModal)
  const setShowAboutModal = useUIStore((s) => s.setShowAboutModal)
  const checkForUpdates = useUpdaterStore((s) => s.check)
  const { t } = useTranslation()
  const langId = useId()
  const fontId = useId()
  const timeoutId = useId()
  const sslId = useId()
  const proxyModeId = useId()
  const proxyHostId = useId()
  const proxyPortId = useId()
  const autoUpdateId = useId()

  /** Why the last save failed — keeps the dialog open instead of pretending. */
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Why the stored settings could not be read; the form is showing defaults. */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsState>({
    theme: currentTheme,
    language: currentLocale,
    fontSize: currentFontSize,
    timeout: 30000,
    sslVerification: true,
    autoUpdate: true,
    proxyMode: 'system',
    proxyHost: '',
    proxyPort: '',
  })

  useEffect(() => {
    if (!show) return
    const api = getSettingsApi()
    if (!api?.getAll) return
    api
      .getAll()
      .then((res) => {
        // `{success:false}` is how this bridge REPORTS failure — a thrown
        // rejection is the rarer path. Returning early here meant the common
        // case stayed silent and the form showed defaults anyway, which is the
        // exact behaviour the catch below exists to prevent. The renderer
        // prefixes the localized sentence, so the detail carried here stays raw.
        if (res && res.success === false) throw new Error(res.error ?? 'unknown error')
        if (!res?.success || !res.data) return
        const s = res.data as {
          defaultTimeout?: number
          sslVerification?: boolean
          autoUpdate?: boolean
          proxy?: { mode?: string; host?: string; port?: number }
        }
        setSettings((prev) => ({
          ...prev,
          timeout: s.defaultTimeout ?? prev.timeout,
          sslVerification: s.sslVerification ?? prev.sslVerification,
          autoUpdate: s.autoUpdate ?? prev.autoUpdate,
          proxyMode: (s.proxy?.mode as SettingsState['proxyMode']) ?? prev.proxyMode,
          proxyHost: s.proxy?.host ?? prev.proxyHost,
          proxyPort: s.proxy?.port != null ? String(s.proxy.port) : prev.proxyPort,
        }))
      })
      .catch((e: unknown) => {
        // Not silent: the form would otherwise show DEFAULTS that look like the
        // saved configuration, and pressing Save would write them over it.
        setLoadError(e instanceof Error ? e.message : String(e))
      })
  }, [show])

  if (!show) return null

  const update = (partial: Partial<SettingsState>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }

  const themeLabels: Record<Theme, string> = {
    light: t('settings.light'),
    dark: t('settings.dark'),
    system: t('settings.system'),
  }

  /**
   * Persist, THEN close.
   *
   * The promise used to be fire-and-forget (`.catch(() => {})`) with an
   * unconditional `setShow(false)` right after — so a rejected write closed the
   * dialog exactly like a successful one. That is bad for any setting and
   * unacceptable for `sslVerification`: a user turning certificate checking off
   * (or back ON) got no indication their choice never landed.
   */
  const handleSave = async (): Promise<void> => {
    setTheme(settings.theme)
    setLocale(settings.language)
    setFontSize(settings.fontSize)
    const api = getSettingsApi()
    if (api?.setAll) {
      try {
        const res = await api.setAll({
          defaultTimeout: settings.timeout,
          sslVerification: settings.sslVerification,
          autoUpdate: settings.autoUpdate,
          proxy: {
            mode: settings.proxyMode,
            ...(settings.proxyHost ? { host: settings.proxyHost } : {}),
            ...(settings.proxyPort ? { port: Number(settings.proxyPort) } : {}),
          },
        })
        if (res && res.success === false) throw new Error(res.error ?? t('settings.saveFailed'))
      } catch (e) {
        // Stay open so the user can retry or copy their values out.
        setSaveError(e instanceof Error ? e.message : String(e))
        return
      }
    }
    toast.success(t('settings.saved'))
    setShow(false)
  }

  const handleCheckUpdates = () => {
    setShow(false)
    setShowUpdateModal(true)
    checkForUpdates()
  }

  return (
    <Modal open={show} onOpenChange={setShow} title={t('settings.title')} testId="settings-modal">
      <div
        className="w-[520px] max-w-[95%] rounded-[14px] bg-[var(--white)] p-7"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {t('settings.title')}
          </span>
          <button
            type="button"
            aria-label={t('a11y.closeDialog')}
            onClick={() => setShow(false)}
            className="cursor-pointer text-[var(--hint)] hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5">
          {/* Theme */}
          <div>
            <label className="mb-1.5 block font-medium text-[var(--muted)]">
              {t('settings.theme')}
            </label>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as Theme[]).map((thm) => (
                <button
                  key={thm}
                  type="button"
                  onClick={() => update({ theme: thm })}
                  className="cursor-pointer rounded-[7px] px-3 py-1.5 transition-colors"
                  style={{
                    background: settings.theme === thm ? 'var(--accent-light)' : 'var(--bg)',
                    color: settings.theme === thm ? 'var(--accent-text)' : 'var(--text)',
                    border: `1px solid ${settings.theme === thm ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {themeLabels[thm]}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label htmlFor={langId} className="mb-1.5 block font-medium text-[var(--muted)]">
              {t('settings.language')}
            </label>
            <select
              id={langId}
              value={settings.language}
              onChange={(e) => update({ language: e.target.value as Language })}
              className="rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none"
            >
              <option value="en">{t('settings.english')}</option>
              <option value="tr">{t('settings.turkish')}</option>
            </select>
          </div>

          {/* Font size */}
          <div>
            <label htmlFor={fontId} className="mb-1.5 block font-medium text-[var(--muted)]">
              {t('settings.fontSize')}
            </label>
            <input
              id={fontId}
              type="number"
              value={settings.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              min={10}
              max={20}
              className="w-20 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none"
            />
            <span className="ml-2 text-[var(--muted)]">px</span>
          </div>

          {/* Timeout */}
          <div>
            <label htmlFor={timeoutId} className="mb-1.5 block font-medium text-[var(--muted)]">
              {t('settings.timeout')}
            </label>
            <input
              id={timeoutId}
              type="number"
              value={settings.timeout}
              onChange={(e) => update({ timeout: Number(e.target.value) })}
              className="w-28 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none"
            />
            <span className="ml-2 text-[var(--muted)]">ms</span>
          </div>

          {/* SSL Verification */}
          <div className="flex items-center gap-2">
            <input
              id={sslId}
              type="checkbox"
              checked={settings.sslVerification}
              onChange={(e) => update({ sslVerification: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            <label htmlFor={sslId} className="text-[var(--text)]">
              {t('settings.sslVerification')}
            </label>
          </div>

          {/* Proxy */}
          <div>
            <label htmlFor={proxyModeId} className="mb-1.5 block font-medium text-[var(--muted)]">
              {t('settings.proxy')}
            </label>
            <select
              id={proxyModeId}
              value={settings.proxyMode}
              onChange={(e) =>
                update({ proxyMode: e.target.value as 'system' | 'none' | 'custom' })
              }
              className="rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none"
            >
              <option value="system">{t('settings.systemProxy')}</option>
              <option value="none">{t('settings.noProxy')}</option>
              <option value="custom">{t('settings.customProxy')}</option>
            </select>

            {settings.proxyMode === 'custom' && (
              <div className="mt-2 flex gap-2">
                <input
                  id={proxyHostId}
                  aria-label={t('settings.host')}
                  value={settings.proxyHost}
                  onChange={(e) => update({ proxyHost: e.target.value })}
                  placeholder={t('settings.host')}
                  className="flex-1 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none"
                />
                <input
                  id={proxyPortId}
                  aria-label={t('settings.port')}
                  value={settings.proxyPort}
                  onChange={(e) => update({ proxyPort: e.target.value })}
                  placeholder={t('settings.port')}
                  className="w-20 rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none"
                />
              </div>
            )}
          </div>

          {/* Auto Update */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                id={autoUpdateId}
                type="checkbox"
                checked={settings.autoUpdate}
                onChange={(e) => update({ autoUpdate: e.target.checked })}
                className="accent-[var(--accent)]"
              />
              <label htmlFor={autoUpdateId} className="text-[var(--text)]">
                {t('settings.autoUpdate')}
              </label>
            </div>
            <button
              type="button"
              onClick={handleCheckUpdates}
              className="cursor-pointer rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            >
              {t('settings.checkForUpdates')}
            </button>
          </div>
        </div>

        {(saveError || loadError) && (
          <p role="alert" className="mt-4 mb-0 text-xs" style={{ color: '#cc2200' }}>
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
            className="cursor-pointer rounded-[7px] border-none bg-transparent px-1 py-1 text-[var(--muted)] underline-offset-2 hover:underline"
            style={{ fontSize: 13 }}
          >
            {t('header.about')}
          </button>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => setShow(false)}
              className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[#555] transition-colors hover:bg-[var(--bg)]"
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
