import { useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { toast } from '../../lib/toast'
import type { AuthConfig, AuthType, Folder } from '../../types'

/**
 * Folder-level auth + cascade scripts editor. Descendant requests whose own
 * auth is 'inherit' fall back to the nearest folder that sets one (then the
 * project); folder pre/test scripts run in the cascade (project → folder →
 * request) on both Send and Run.
 *
 * Mirrors the project-level Authorization + Scripts panes but writes to the
 * folder row via `folder:update`. Auth is stored as a JSON-encoded AuthConfig
 * (NULL when 'inherit', so it stays transparent up the chain).
 */

const FOLDER_AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'inherit', label: 'Inherit from parent' },
  { value: 'none', label: 'No Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'api-key', label: 'API Key' },
]

const INPUT =
  'w-full rounded-[7px] border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-[13px] outline-none'
const LABEL = 'mb-1.5 block text-[12px] font-medium'

export default function FolderSettingsModal({
  folderId,
  folderName,
  open,
  onClose,
  onSaved,
}: {
  folderId: string
  folderName: string
  open: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const [tab, setTab] = useState<'auth' | 'scripts'>('auth')
  const [auth, setAuth] = useState<AuthConfig>({ type: 'inherit' })
  const [preScript, setPreScript] = useState('')
  const [postScript, setPostScript] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setTab('auth')
    ;(async () => {
      try {
        const res = (await window.api?.folder?.list(activeProjectId ?? '')) as
          | { success: boolean; data?: Folder[] }
          | undefined
        const row = res?.success ? res.data?.find((f) => f.id === folderId) : undefined
        if (cancelled) return
        let parsed: AuthConfig = { type: 'inherit' }
        if (row?.auth) {
          try {
            parsed = JSON.parse(row.auth) as AuthConfig
          } catch {
            parsed = { type: 'inherit' }
          }
        }
        setAuth(parsed && parsed.type ? parsed : { type: 'inherit' })
        setPreScript(row?.pre_script ?? '')
        setPostScript(row?.post_script ?? '')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, folderId, activeProjectId])

  async function handleSave() {
    setSaving(true)
    try {
      // 'inherit' stores NULL so the folder stays transparent up the chain.
      const authJson = auth.type === 'inherit' ? null : JSON.stringify(auth)
      const res = (await window.api?.folder?.update(folderId, {
        auth: authJson,
        pre_script: preScript.trim() ? preScript : null,
        post_script: postScript.trim() ? postScript : null,
      })) as { success: boolean; error?: string } | undefined
      if (res?.success) {
        toast.success(t('folderSettings.saved') || 'Folder settings saved')
        onSaved?.()
        onClose()
      } else {
        toast.error(res?.error || 'Save failed')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('folderSettings.title') || 'Folder Settings'}
      contentStyle={{ width: 560, maxWidth: '92vw' }}
    >
      <div
        className="flex max-h-[82vh] flex-col rounded-xl"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div className="border-b px-5 py-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
            {t('folderSettings.title') || 'Folder Settings'}
          </div>
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
            {folderName}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b px-4 pt-2" style={{ borderColor: 'var(--border)' }}>
          {(['auth', 'scripts'] as const).map((tk) => (
            <button
              key={tk}
              type="button"
              onClick={() => setTab(tk)}
              className="cursor-pointer rounded-t-[7px] px-3 py-2 text-[13px]"
              style={{
                color: tab === tk ? 'var(--accent-text)' : 'var(--muted)',
                borderBottom: tab === tk ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: tab === tk ? 600 : 400,
                background: 'transparent',
                border: 'none',
                borderBottomWidth: 2,
                borderBottomStyle: 'solid',
                borderBottomColor: tab === tk ? 'var(--accent)' : 'transparent',
              }}
            >
              {tk === 'auth'
                ? t('folderSettings.authorization') || 'Authorization'
                : t('folderSettings.scripts') || 'Scripts'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4" style={{ color: 'var(--text)' }}>
          {loading ? (
            <div className="py-8 text-center text-[13px]" style={{ color: 'var(--hint)' }}>
              …
            </div>
          ) : tab === 'auth' ? (
            <div className="space-y-3">
              <div>
                <label className={LABEL} style={{ color: 'var(--muted)' }}>
                  {t('folderSettings.authType') || 'Type'}
                </label>
                <select
                  className={INPUT}
                  style={{ color: 'var(--text)' }}
                  value={auth.type}
                  onChange={(e) => setAuth({ type: e.target.value as AuthType })}
                >
                  {FOLDER_AUTH_TYPES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {auth.type === 'inherit' && (
                <p className="text-[12px]" style={{ color: 'var(--hint)' }}>
                  {t('folderSettings.inheritHint') ||
                    'Requests in this folder inherit auth from the parent folder or project.'}
                </p>
              )}
              {auth.type === 'none' && (
                <p className="text-[12px]" style={{ color: 'var(--hint)' }}>
                  {t('folderSettings.noneHint') ||
                    'Requests in this folder send no authorization (overrides any parent auth).'}
                </p>
              )}

              {auth.type === 'bearer' && (
                <div>
                  <label className={LABEL} style={{ color: 'var(--muted)' }}>
                    Token
                  </label>
                  <input
                    className={INPUT}
                    style={{ color: 'var(--text)' }}
                    placeholder="{{accessToken}}"
                    value={auth.bearer?.token ?? ''}
                    onChange={(e) =>
                      setAuth({
                        type: 'bearer',
                        bearer: { token: e.target.value, prefix: 'Bearer' },
                      })
                    }
                  />
                </div>
              )}

              {auth.type === 'basic' && (
                <div className="space-y-3">
                  <div>
                    <label className={LABEL} style={{ color: 'var(--muted)' }}>
                      Username
                    </label>
                    <input
                      className={INPUT}
                      style={{ color: 'var(--text)' }}
                      value={auth.basic?.username ?? ''}
                      onChange={(e) =>
                        setAuth({
                          type: 'basic',
                          basic: { username: e.target.value, password: auth.basic?.password ?? '' },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={LABEL} style={{ color: 'var(--muted)' }}>
                      Password
                    </label>
                    <input
                      className={INPUT}
                      style={{ color: 'var(--text)' }}
                      value={auth.basic?.password ?? ''}
                      onChange={(e) =>
                        setAuth({
                          type: 'basic',
                          basic: { username: auth.basic?.username ?? '', password: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {auth.type === 'api-key' && (
                <div className="space-y-3">
                  <div>
                    <label className={LABEL} style={{ color: 'var(--muted)' }}>
                      Key
                    </label>
                    <input
                      className={INPUT}
                      style={{ color: 'var(--text)' }}
                      value={auth.apiKey?.key ?? ''}
                      onChange={(e) =>
                        setAuth({
                          type: 'api-key',
                          apiKey: {
                            key: e.target.value,
                            value: auth.apiKey?.value ?? '',
                            in: auth.apiKey?.in ?? 'header',
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={LABEL} style={{ color: 'var(--muted)' }}>
                      Value
                    </label>
                    <input
                      className={INPUT}
                      style={{ color: 'var(--text)' }}
                      value={auth.apiKey?.value ?? ''}
                      onChange={(e) =>
                        setAuth({
                          type: 'api-key',
                          apiKey: {
                            key: auth.apiKey?.key ?? '',
                            value: e.target.value,
                            in: auth.apiKey?.in ?? 'header',
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={LABEL} style={{ color: 'var(--muted)' }}>
                      Add to
                    </label>
                    <select
                      className={INPUT}
                      style={{ color: 'var(--text)' }}
                      value={auth.apiKey?.in ?? 'header'}
                      onChange={(e) =>
                        setAuth({
                          type: 'api-key',
                          apiKey: {
                            key: auth.apiKey?.key ?? '',
                            value: auth.apiKey?.value ?? '',
                            in: e.target.value as 'header' | 'query',
                          },
                        })
                      }
                    >
                      <option value="header">Header</option>
                      <option value="query">Query Param</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className={LABEL} style={{ color: 'var(--muted)' }}>
                  {t('folderSettings.preRequest') || 'Pre-request Script'}
                </label>
                <textarea
                  className={INPUT}
                  style={{
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono, monospace)',
                    minHeight: 120,
                  }}
                  spellCheck={false}
                  placeholder="pm.environment.set('accessToken', ...)"
                  value={preScript}
                  onChange={(e) => setPreScript(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL} style={{ color: 'var(--muted)' }}>
                  {t('folderSettings.testScript') || 'Test Script'}
                </label>
                <textarea
                  className={INPUT}
                  style={{
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono, monospace)',
                    minHeight: 120,
                  }}
                  spellCheck={false}
                  placeholder="pm.test('status is 200', () => pm.response.to.have.status(200))"
                  value={postScript}
                  onChange={(e) => setPostScript(e.target.value)}
                />
              </div>
              <p className="text-[12px]" style={{ color: 'var(--hint)' }}>
                {t('folderSettings.cascadeHint') ||
                  'These run in cascade: project → folder → request (pre-request before each request, test after).'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[7px] px-3.5 py-2 text-[13px]"
            style={{
              background: 'var(--surface)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            }}
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="cursor-pointer rounded-[7px] px-3.5 py-2 text-[13px] font-medium"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {t('common.save') || 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
