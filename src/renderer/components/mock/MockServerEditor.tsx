/**
 * Mock-server editor opened in the workbench. Tabs: Endpoints / Settings / Logs.
 * Each tab is a self-contained block; settings are saved on blur, endpoints
 * are CRUDed via the store.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Play, Square, RefreshCw } from 'lucide-react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type {
  MockEndpoint,
  MockResponse,
  MockMethod,
  MockPathMode,
  MockBodyType,
  MockCondition,
  MockServer,
  MockLogEntry,
} from '../../types'
import MonacoWrapper from '../shared/MonacoWrapper'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import { CONDITION_SNIPPETS, SCRIPT_SNIPPETS } from '../../lib/mock-snippets'

const METHODS: MockMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']
const PATH_MODES: MockPathMode[] = ['exact', 'param', 'wildcard', 'regex']
const BODY_TYPES: MockBodyType[] = ['json', 'xml', 'text', 'html']

// Stable empty references — used as Zustand selector fallbacks so we don't emit
// a new `[]` literal each render and trip React's "Maximum update depth"
// guardrail in useSyncExternalStore.
const EMPTY_ENDPOINTS: readonly MockEndpoint[] = []
const EMPTY_RESPONSES: readonly MockResponse[] = []
const EMPTY_LOGS: readonly MockLogEntry[] = []

export default function MockServerEditor({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const server = useMockStore((s) => s.servers.find((x) => x.id === serverId)) ?? null
  const status = useMockStore((s) => s.statusByServer[serverId] ?? 'stopped')
  const error = useMockStore((s) => s.errorByServer[serverId] ?? null)
  const startServer = useMockStore((s) => s.startServer)
  const stopServer = useMockStore((s) => s.stopServer)
  const [tab, setTab] = useState<'endpoints' | 'settings' | 'logs'>('endpoints')

  if (!server) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
        {t('mock.serverNotFound')}
      </div>
    )
  }

  const dot =
    status === 'running'
      ? '#1a7a4a'
      : status === 'starting'
        ? '#b35a00'
        : status === 'error'
          ? '#cc2200'
          : '#999'

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--heading)' }}>
          {server.name}
        </h2>
        <span
          className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs"
          style={{ border: `1px solid ${dot}40`, background: `${dot}15`, color: dot }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
          {status}
        </span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {server.host}:{server.port}
          {server.basePath ? ` · ${server.basePath}` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          {status === 'running' ? (
            <button
              onClick={() => stopServer(serverId)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)', color: '#cc2200', background: 'var(--white)' }}
            >
              <Square size={12} /> {t('mock.stop')}
            </button>
          ) : (
            <button
              onClick={() => startServer(serverId)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)', color: '#1a7a4a', background: 'var(--white)' }}
            >
              <Play size={12} /> {t('mock.start')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="shrink-0 px-4 py-1.5 text-xs"
          style={{ background: '#cc220015', color: '#cc2200', borderBottom: '1px solid #cc220040' }}
        >
          {error}
        </div>
      )}

      <div
        className="flex shrink-0 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <TabBtn active={tab === 'endpoints'} onClick={() => setTab('endpoints')}>
          {t('mock.tabEndpoints')}
        </TabBtn>
        <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')}>
          {t('mock.tabSettings')}
        </TabBtn>
        <TabBtn active={tab === 'logs'} onClick={() => setTab('logs')}>
          {t('mock.tabLogs')}
        </TabBtn>
      </div>

      <div className="flex min-h-0 flex-1">
        {tab === 'endpoints' && <EndpointsTab serverId={serverId} />}
        {tab === 'settings' && <SettingsTab server={server} />}
        {tab === 'logs' && <LogsTab serverId={serverId} />}
      </div>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="border-b-2 px-4 py-2 text-xs font-semibold"
      style={{
        borderColor: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accentText)' : 'var(--muted)',
        background: 'transparent',
      }}
    >
      {children}
    </button>
  )
}

// ─── Endpoints tab ───────────────────────────────────────────────

function EndpointsTab({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const endpoints = useMockStore((s) => s.endpointsByServer[serverId]) ?? EMPTY_ENDPOINTS
  const loadEndpoints = useMockStore((s) => s.loadEndpoints)
  const createEndpoint = useMockStore((s) => s.createEndpoint)
  const deleteEndpoint = useMockStore((s) => s.deleteEndpoint)
  const importOpenApi = useMockStore((s) => s.importOpenApi)
  const importPostman = useMockStore((s) => s.importPostman)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  // Styled confirm instead of the native window.confirm (issue #28).
  const [deleteTarget, setDeleteTarget] = useState<MockEndpoint | null>(null)

  useEffect(() => {
    loadEndpoints(serverId)
  }, [serverId, loadEndpoints])

  useEffect(() => {
    if (!activeId && endpoints.length > 0) setActiveId(endpoints[0].id)
  }, [endpoints, activeId])

  async function handleAdd(): Promise<void> {
    const ep = await createEndpoint({
      serverId,
      method: 'GET',
      path: '/new-endpoint',
      pathMode: 'exact',
    })
    if (ep) setActiveId(ep.id)
  }

  async function handleImport(kind: 'openapi' | 'postman'): Promise<void> {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = kind === 'openapi' ? '.json,.yaml,.yml' : '.json'
    input.onchange = async (): Promise<void> => {
      const f = input.files?.[0]
      if (!f) return
      setImportStatus(t('mock.importing'))
      const text = await f.text()
      const result =
        kind === 'openapi'
          ? await importOpenApi(serverId, text)
          : await importPostman(serverId, text)
      setImportStatus(null)
      if (!result) {
        toast.error(t('mock.importFailed'))
        return
      }
      if (!result.ok && result.error) {
        toast.error(`${t('mock.importFailed')}: ${result.error}`)
        return
      }
      const warn =
        result.warnings.length > 0 ? ` (${result.warnings.length} ${t('mock.warnings')})` : ''
      toast.success(
        `${result.endpointsCreated} endpoints, ${result.responsesCreated} responses imported${warn}`,
      )
    }
    input.click()
  }

  return (
    <>
      {/* Endpoint list */}
      <div
        className="flex w-72 shrink-0 flex-col border-r"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <div
          className="flex flex-col gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('mock.endpoints')}
            </span>
            <button
              onClick={handleAdd}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              <Plus size={12} /> {t('mock.add')}
            </button>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => handleImport('openapi')}
              className="flex-1 rounded border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--muted)',
                background: 'var(--white)',
              }}
            >
              {t('mock.importOpenApi')}
            </button>
            <button
              onClick={() => handleImport('postman')}
              className="flex-1 rounded border px-2 py-0.5 text-[11px]"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--muted)',
                background: 'var(--white)',
              }}
            >
              {t('mock.importPostman')}
            </button>
          </div>
          {importStatus && (
            <div className="text-[11px]" style={{ color: 'var(--accentText)' }}>
              {importStatus}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {endpoints.length === 0 ? (
            <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
              {t('mock.noEndpoints')}
            </div>
          ) : (
            endpoints.map((ep) => (
              <div
                key={ep.id}
                onClick={() => setActiveId(ep.id)}
                className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-xs"
                style={{
                  borderColor: 'var(--border)',
                  background: activeId === ep.id ? 'var(--accentLight)' : 'transparent',
                }}
              >
                <span
                  className="rounded px-1.5 py-0.5 font-mono font-semibold"
                  style={methodStyle(ep.method)}
                >
                  {ep.method}
                </span>
                <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                  {ep.path}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(ep)
                  }}
                  className="cursor-pointer text-xs"
                  style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
                  title={t('mock.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Endpoint editor */}
      <div className="min-w-0 flex-1 overflow-auto">
        {activeId && endpoints.find((e) => e.id === activeId) ? (
          <EndpointEditor
            key={activeId}
            serverId={serverId}
            endpoint={endpoints.find((e) => e.id === activeId)!}
          />
        ) : (
          <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
            {t('mock.selectEndpoint')}
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        itemName={deleteTarget?.path ?? ''}
        itemType="endpoint"
        onConfirm={() => {
          if (deleteTarget) deleteEndpoint(serverId, deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}

function methodStyle(method: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    GET: { bg: '#e8f4ff', color: '#0066cc', border: '#b3d4f5' },
    POST: { bg: '#e8f9f1', color: '#1a7a4a', border: '#b3e5cc' },
    PUT: { bg: '#fff4e0', color: '#b35a00', border: '#f5d4a0' },
    PATCH: { bg: '#f0faf5', color: '#0a7a5a', border: '#a0e0c8' },
    DELETE: { bg: '#fff0f0', color: '#cc2200', border: '#f5b3b3' },
  }
  const m = map[method] ?? { bg: '#eee', color: '#333', border: '#ccc' }
  return { background: m.bg, color: m.color, border: `1px solid ${m.border}` }
}

// ─── Endpoint editor ─────────────────────────────────────────────

function EndpointEditor({ serverId, endpoint }: { serverId: string; endpoint: MockEndpoint }) {
  const { t } = useTranslation()
  const updateEndpoint = useMockStore((s) => s.updateEndpoint)
  const responses = useMockStore((s) => s.responsesByEndpoint[endpoint.id]) ?? EMPTY_RESPONSES
  const loadResponses = useMockStore((s) => s.loadResponses)
  const createResponse = useMockStore((s) => s.createResponse)
  const server = useMockStore((s) => s.servers.find((sv) => sv.id === serverId)) ?? null
  const status = useMockStore((s) => s.statusByServer[serverId] ?? 'stopped')
  const [activeRespId, setActiveRespId] = useState<string | null>(null)

  useEffect(() => {
    loadResponses(endpoint.id)
  }, [endpoint.id, loadResponses])

  useEffect(() => {
    if (!activeRespId && responses.length > 0) setActiveRespId(responses[0].id)
  }, [responses, activeRespId])

  async function handleAddResponse(): Promise<void> {
    const r = await createResponse({
      endpointId: endpoint.id,
      name: t('mock.defaultResponse'),
      statusCode: 200,
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      bodyType: 'json',
      body: '{\n  "ok": true\n}',
      delayMs: 0,
      condition: { type: 'always' },
      script: '',
      order: responses.length,
      enabled: true,
    })
    if (r) setActiveRespId(r.id)
  }

  return (
    <div className="flex flex-col p-4 gap-4">
      <div>
        <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('mock.endpointDefinition')}
        </h3>
        <div className="grid grid-cols-[160px_1fr] gap-2">
          <select
            value={endpoint.method}
            onChange={(e) => updateEndpoint(endpoint.id, { method: e.target.value as MockMethod })}
            className="rounded border px-2 py-1 text-sm"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={endpoint.path}
            onChange={(e) => updateEndpoint(endpoint.id, { path: e.target.value })}
            placeholder="/users/:id"
            className="rounded border px-2 py-1 font-mono text-sm"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          />
        </div>

        <FullUrlBar server={server} status={status} endpoint={endpoint} />

        <div className="mt-2 flex items-center gap-2 text-xs">
          <label style={{ color: 'var(--muted)' }}>{t('mock.pathMode')}:</label>
          <select
            value={endpoint.pathMode}
            onChange={(e) =>
              updateEndpoint(endpoint.id, { pathMode: e.target.value as MockPathMode })
            }
            className="rounded border px-2 py-1"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          >
            {PATH_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label
            className="ml-3 flex items-center gap-1.5 cursor-pointer"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={endpoint.enabled}
              onChange={(e) => updateEndpoint(endpoint.id, { enabled: e.target.checked })}
            />
            {t('mock.enabled')}
          </label>
          <label className="ml-3 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
            {t('mock.priority')}:
            <input
              type="number"
              value={endpoint.priority}
              onChange={(e) =>
                updateEndpoint(endpoint.id, { priority: Number(e.target.value) || 0 })
              }
              className="rounded border px-2 py-1"
              style={{
                width: 60,
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <JsonConfigField
            label={t('mock.endpointAuthOverride')}
            value={endpoint.authOverride}
            onCommit={(v) =>
              updateEndpoint(endpoint.id, {
                authOverride: (v ?? null) as MockEndpoint['authOverride'],
              })
            }
            hint={t('mock.endpointAuthOverrideHint')}
            rows={4}
            allowEmpty
          />
          <JsonConfigField
            label={t('mock.endpointSchemaValidation')}
            value={endpoint.schemaValidation}
            onCommit={(v) =>
              updateEndpoint(endpoint.id, {
                schemaValidation: (v ?? null) as MockEndpoint['schemaValidation'],
              })
            }
            hint={t('mock.endpointSchemaValidationHint')}
            rows={4}
            allowEmpty
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
            {t('mock.responses')}
          </h3>
          <button
            onClick={handleAddResponse}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
          >
            <Plus size={12} /> {t('mock.addResponse')}
          </button>
        </div>
        {responses.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {t('mock.noResponses')}
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1">
              {responses.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveRespId(r.id)}
                  className="rounded border px-2 py-0.5 text-xs"
                  style={{
                    borderColor: activeRespId === r.id ? 'var(--accent)' : 'var(--border)',
                    background: activeRespId === r.id ? 'var(--accentLight)' : 'var(--white)',
                    color: activeRespId === r.id ? 'var(--accentText)' : 'var(--text)',
                  }}
                >
                  {r.name || `${r.statusCode}`} ({r.statusCode})
                </button>
              ))}
            </div>
            {activeRespId && responses.find((r) => r.id === activeRespId) && (
              <ResponseEditor
                key={activeRespId}
                response={responses.find((r) => r.id === activeRespId)!}
                endpointId={endpoint.id}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Full URL bar (Copy / Open / Copy as cURL) ───────────────────

function FullUrlBar({
  server,
  status,
  endpoint,
}: {
  server: MockServer | null
  status: string
  endpoint: MockEndpoint
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'' | 'url' | 'curl'>('')

  if (!server) return null

  // Browsers can't visit ws:/wss: paths, and ANY method or non-GET shouldn't
  // open in a browser even on http. Path-param/wildcard/regex modes have
  // placeholders that won't resolve to a real address.
  const fullUrl = `http://${server.host}:${server.port}${server.basePath}${endpoint.path}`
  const canOpen =
    status === 'running' &&
    (endpoint.method === 'GET' || endpoint.method === 'ANY') &&
    endpoint.pathMode === 'exact'

  const curl = buildCurl(server, endpoint)

  async function copy(kind: 'url' | 'curl', text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* ignore */
    }
  }

  function open(): void {
    const url = `http://${server!.host}:${server!.port}${server!.basePath}${endpoint.path}`
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div
      className="mt-2 flex items-center gap-2 rounded border px-2 py-1.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        URL
      </span>
      <code
        className="flex-1 truncate font-mono text-xs"
        style={{ color: 'var(--text)' }}
        title={fullUrl}
      >
        {fullUrl}
      </code>
      {status !== 'running' && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{ background: '#cc220015', color: '#cc2200', border: '1px solid #cc220040' }}
          title={t('mock.startServerToTest')}
        >
          {t('mock.notRunning')}
        </span>
      )}
      <button
        onClick={() => copy('url', fullUrl)}
        className="rounded border px-2 py-0.5 text-[11px]"
        style={{
          borderColor: 'var(--border)',
          color: copied === 'url' ? '#1a7a4a' : 'var(--muted)',
          background: 'var(--white)',
        }}
        title={t('mock.copyUrl')}
      >
        {copied === 'url' ? '✓' : '⧉'} {t('mock.copyUrl')}
      </button>
      <button
        onClick={() => copy('curl', curl)}
        className="rounded border px-2 py-0.5 text-[11px]"
        style={{
          borderColor: 'var(--border)',
          color: copied === 'curl' ? '#1a7a4a' : 'var(--muted)',
          background: 'var(--white)',
        }}
        title={t('mock.copyCurl')}
      >
        {copied === 'curl' ? '✓' : '⧉'} cURL
      </button>
      <button
        onClick={open}
        disabled={!canOpen}
        className="rounded border px-2 py-0.5 text-[11px]"
        style={{
          borderColor: 'var(--border)',
          color: canOpen ? 'var(--accentText)' : 'var(--hint)',
          background: 'var(--white)',
          opacity: canOpen ? 1 : 0.5,
          cursor: canOpen ? 'pointer' : 'not-allowed',
        }}
        title={
          !canOpen
            ? endpoint.pathMode !== 'exact'
              ? t('mock.openHintPath')
              : endpoint.method !== 'GET' && endpoint.method !== 'ANY'
                ? t('mock.openHintMethod')
                : t('mock.openHintRunning')
            : t('mock.openInBrowser')
        }
      >
        ↗ {t('mock.openInBrowser')}
      </button>
    </div>
  )
}

function buildCurl(server: MockServer, endpoint: MockEndpoint): string {
  const url = `http://${server.host}:${server.port}${server.basePath}${endpoint.path}`
  const method = endpoint.method === 'ANY' ? 'GET' : endpoint.method
  const parts = [`curl -X ${method} '${url}'`]
  // For methods that typically carry a body, hint at a placeholder content-type + body.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    parts.push(`-H 'Content-Type: application/json'`)
    parts.push(`-d '{}'`)
  }
  return parts.join(' \\\n  ')
}

// ─── Response editor ─────────────────────────────────────────────

function ResponseEditor({ response, endpointId }: { response: MockResponse; endpointId: string }) {
  const { t } = useTranslation()
  const updateResponse = useMockStore((s) => s.updateResponse)
  const deleteResponse = useMockStore((s) => s.deleteResponse)
  const condStr = useMemo(() => JSON.stringify(response.condition, null, 2), [response.condition])
  const [condText, setCondText] = useState(condStr)
  const [condError, setCondError] = useState<string | null>(null)

  useEffect(() => {
    setCondText(condStr)
    setCondError(null)
  }, [condStr])

  function commitCondition(): void {
    try {
      const parsed = JSON.parse(condText) as MockCondition
      updateResponse(response.id, { condition: parsed })
      setCondError(null)
    } catch (e) {
      setCondError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className="rounded border p-3"
      style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
    >
      <div className="mb-2 grid grid-cols-[140px_1fr_140px_auto] gap-2">
        <input
          type="number"
          value={response.statusCode}
          onChange={(e) =>
            updateResponse(response.id, { statusCode: Number(e.target.value) || 200 })
          }
          className="rounded border px-2 py-1 text-sm"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
        <input
          type="text"
          value={response.name}
          onChange={(e) => updateResponse(response.id, { name: e.target.value })}
          placeholder={t('mock.responseName')}
          className="rounded border px-2 py-1 text-sm"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
        <select
          value={response.bodyType}
          onChange={(e) =>
            updateResponse(response.id, { bodyType: e.target.value as MockBodyType })
          }
          className="rounded border px-2 py-1 text-xs"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        >
          {BODY_TYPES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (confirm(t('mock.confirmDeleteResponse'))) deleteResponse(endpointId, response.id)
          }}
          className="rounded border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--border)', color: '#cc2200', background: 'var(--white)' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="mb-2 flex items-center gap-3 text-xs">
        <label style={{ color: 'var(--muted)' }}>
          {t('mock.delayMs')}:
          <input
            type="number"
            value={response.delayMs}
            onChange={(e) => updateResponse(response.id, { delayMs: Number(e.target.value) || 0 })}
            className="ml-1 rounded border px-2 py-1"
            style={{ width: 70, background: 'var(--white)', borderColor: 'var(--border)' }}
          />
        </label>
        <label
          className="flex cursor-pointer items-center gap-1.5"
          style={{ color: 'var(--text)' }}
        >
          <input
            type="checkbox"
            checked={response.enabled}
            onChange={(e) => updateResponse(response.id, { enabled: e.target.checked })}
          />
          {t('mock.enabled')}
        </label>
      </div>

      <div className="mb-2">
        <label
          className="mb-1 block text-[11px] uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {t('mock.headers')}
        </label>
        <HeadersTable
          headers={response.headers}
          onChange={(headers) => updateResponse(response.id, { headers })}
        />
      </div>

      <div className="mb-2">
        <label
          className="mb-1 block text-[11px] uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {t('mock.body')}
        </label>
        <div style={{ height: 200, border: '1px solid var(--border)', borderRadius: 4 }}>
          <MonacoWrapper
            value={response.body}
            onChange={(v) => updateResponse(response.id, { body: v })}
            language={
              response.bodyType === 'json'
                ? 'json'
                : response.bodyType === 'xml'
                  ? 'xml'
                  : 'plaintext'
            }
          />
        </div>
        <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('mock.bodyHint')}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label
            className="block text-[11px] uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            {t('mock.condition')}
          </label>
          <SnippetPicker
            label={t('mock.insertExample')}
            snippets={CONDITION_SNIPPETS}
            onPick={(body) => {
              setCondText(body)
              try {
                updateResponse(response.id, { condition: JSON.parse(body) as MockCondition })
                setCondError(null)
              } catch (e) {
                setCondError(e instanceof Error ? e.message : String(e))
              }
            }}
          />
        </div>
        <textarea
          value={condText}
          onChange={(e) => setCondText(e.target.value)}
          onBlur={commitCondition}
          rows={5}
          className="w-full rounded border px-2 py-1 font-mono text-xs"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
        {condError && (
          <div className="mt-1 text-xs" style={{ color: '#cc2200' }}>
            {condError}
          </div>
        )}
        <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('mock.conditionHint')}
        </div>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between">
          <label
            className="block text-[11px] uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            {t('mock.script')}
          </label>
          <SnippetPicker
            label={t('mock.insertExample')}
            snippets={SCRIPT_SNIPPETS}
            onPick={(body) => updateResponse(response.id, { script: body })}
          />
        </div>
        <div style={{ height: 180, border: '1px solid var(--border)', borderRadius: 4 }}>
          <MonacoWrapper
            value={response.script ?? ''}
            onChange={(v) => updateResponse(response.id, { script: v })}
            language="javascript"
          />
        </div>
        <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('mock.scriptHint')}
        </div>
      </div>
    </div>
  )
}

/** Compact dropdown that inserts a chosen snippet body into the parent editor. */
function SnippetPicker({
  label,
  snippets,
  onPick,
}: {
  label: string
  snippets: { label: string; description: string; body: string }[]
  onPick: (body: string) => void
}) {
  return (
    <select
      value=""
      onChange={(e) => {
        const i = Number(e.target.value)
        if (Number.isFinite(i) && i >= 0 && i < snippets.length) {
          onPick(snippets[i].body)
        }
        e.target.value = ''
      }}
      className="rounded border px-2 py-0.5 text-[11px]"
      style={{
        background: 'var(--white)',
        borderColor: 'var(--border)',
        color: 'var(--accentText)',
        maxWidth: 220,
      }}
      title={label}
    >
      <option value="">{label}</option>
      {snippets.map((s, i) => (
        <option key={i} value={i} title={s.description}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

function HeadersTable({
  headers,
  onChange,
}: {
  headers: { name: string; value: string }[]
  onChange: (h: { name: string; value: string }[]) => void
}) {
  return (
    <div className="space-y-1">
      {headers.map((h, i) => (
        <div key={i} className="flex gap-1">
          <input
            type="text"
            value={h.name}
            onChange={(e) =>
              onChange(headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
            }
            placeholder="Name"
            className="rounded border px-2 py-1 text-xs"
            style={{ width: 200, background: 'var(--white)', borderColor: 'var(--border)' }}
          />
          <input
            type="text"
            value={h.value}
            onChange={(e) =>
              onChange(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
            placeholder="Value"
            className="flex-1 rounded border px-2 py-1 text-xs"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          />
          <button
            onClick={() => onChange(headers.filter((_, j) => j !== i))}
            className="rounded border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...headers, { name: '', value: '' }])}
        className="rounded border px-2 py-1 text-xs"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--accentText)',
          background: 'var(--white)',
        }}
      >
        + Add header
      </button>
    </div>
  )
}

// ─── Settings tab ────────────────────────────────────────────────

function SettingsTab({ server }: { server: MockServer }) {
  const { t } = useTranslation()
  const updateServer = useMockStore((s) => s.updateServer)
  const [draft, setDraft] = useState(server)

  useEffect(() => setDraft(server), [server])

  function commit<K extends keyof MockServer>(k: K, v: MockServer[K]): void {
    setDraft((d) => ({ ...d, [k]: v }))
    updateServer(server.id, { [k]: v })
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-3 max-w-2xl">
        <Field label={t('mock.name')}>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => commit('name', draft.name)}
            className="w-full rounded border px-2 py-1 text-sm"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          />
        </Field>
        <Field label={t('mock.description')}>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            onBlur={() => commit('description', draft.description)}
            rows={2}
            className="w-full rounded border px-2 py-1 text-sm"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('mock.host')}>
            <select
              value={draft.host}
              onChange={(e) => commit('host', e.target.value as MockServer['host'])}
              className="w-full rounded border px-2 py-1 text-sm"
              style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
            >
              <option value="127.0.0.1">127.0.0.1 ({t('mock.localOnly')})</option>
              <option value="0.0.0.0">0.0.0.0 ({t('mock.allInterfaces')})</option>
            </select>
            {draft.host === '0.0.0.0' && (
              <div className="mt-1 text-xs" style={{ color: '#b35a00' }}>
                ⚠ {t('mock.publicWarning')}
              </div>
            )}
          </Field>
          <Field label={t('mock.port')}>
            <input
              type="number"
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || 0 })}
              onBlur={() => commit('port', draft.port)}
              min={1}
              max={65535}
              className="w-full rounded border px-2 py-1 text-sm"
              style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
            />
          </Field>
        </div>
        <Field label={t('mock.basePath')}>
          <input
            type="text"
            value={draft.basePath}
            onChange={(e) => setDraft({ ...draft, basePath: e.target.value })}
            onBlur={() => commit('basePath', draft.basePath)}
            placeholder="/api/v1"
            className="w-full rounded border px-2 py-1 font-mono text-sm"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          />
        </Field>
        <Field label="">
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={draft.corsEnabled}
              onChange={(e) => commit('corsEnabled', e.target.checked)}
            />
            {t('mock.corsEnabled')}
          </label>
        </Field>
        {draft.corsEnabled && (
          <>
            <Field label={t('mock.corsAllowOrigins')}>
              <input
                type="text"
                value={draft.corsAllowOrigins}
                onChange={(e) => setDraft({ ...draft, corsAllowOrigins: e.target.value })}
                onBlur={() => commit('corsAllowOrigins', draft.corsAllowOrigins)}
                placeholder="* or https://example.com,https://app.com"
                className="w-full rounded border px-2 py-1 font-mono text-sm"
                style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('mock.corsAllowMethods')}>
                <input
                  type="text"
                  value={draft.corsAllowMethods}
                  onChange={(e) => setDraft({ ...draft, corsAllowMethods: e.target.value })}
                  onBlur={() => commit('corsAllowMethods', draft.corsAllowMethods)}
                  className="w-full rounded border px-2 py-1 font-mono text-sm"
                  style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                />
              </Field>
              <Field label={t('mock.corsAllowHeaders')}>
                <input
                  type="text"
                  value={draft.corsAllowHeaders}
                  onChange={(e) => setDraft({ ...draft, corsAllowHeaders: e.target.value })}
                  onBlur={() => commit('corsAllowHeaders', draft.corsAllowHeaders)}
                  className="w-full rounded border px-2 py-1 font-mono text-sm"
                  style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="">
                <label
                  className="flex cursor-pointer items-center gap-2 text-sm"
                  style={{ color: 'var(--text)' }}
                >
                  <input
                    type="checkbox"
                    checked={draft.corsAllowCredentials}
                    onChange={(e) => commit('corsAllowCredentials', e.target.checked)}
                  />
                  {t('mock.corsAllowCredentials')}
                </label>
              </Field>
              <Field label={t('mock.corsMaxAge')}>
                <input
                  type="number"
                  value={draft.corsMaxAge}
                  onChange={(e) => setDraft({ ...draft, corsMaxAge: Number(e.target.value) || 0 })}
                  onBlur={() => commit('corsMaxAge', draft.corsMaxAge)}
                  className="w-full rounded border px-2 py-1 text-sm"
                  style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                />
              </Field>
            </div>
          </>
        )}

        <hr style={{ borderColor: 'var(--border)', margin: '16px 0 8px' }} />
        <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('mock.authentication')}
        </h3>
        <JsonConfigField
          label={t('mock.authConfig')}
          value={draft.authConfig}
          onCommit={(v) => commit('authConfig', v as MockServer['authConfig'])}
          hint={t('mock.authHint')}
          rows={6}
        />

        <hr style={{ borderColor: 'var(--border)', margin: '16px 0 8px' }} />
        <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('mock.failureInjection')}
        </h3>
        <JsonConfigField
          label={t('mock.failureConfig')}
          value={draft.failureConfig}
          onCommit={(v) => commit('failureConfig', v as MockServer['failureConfig'])}
          hint={t('mock.failureHint')}
          rows={5}
        />

        <hr style={{ borderColor: 'var(--border)', margin: '16px 0 8px' }} />
        <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('mock.rateLimit')}
        </h3>
        <JsonConfigField
          label={t('mock.rateLimitConfig')}
          value={draft.rateLimitConfig}
          onCommit={(v) => commit('rateLimitConfig', v as MockServer['rateLimitConfig'])}
          hint={t('mock.rateLimitHint')}
          rows={4}
        />

        <hr style={{ borderColor: 'var(--border)', margin: '16px 0 8px' }} />
        <h3 className="m-0 mb-2 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
          {t('mock.specialModes')}
        </h3>
        <Field label="">
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={draft.echoEnabled}
              onChange={(e) => commit('echoEnabled', e.target.checked)}
            />
            {t('mock.echoEnabled')}
          </label>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('mock.echoHint')}
          </div>
        </Field>
        <Field label="">
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={draft.proxyEnabled}
              onChange={(e) => commit('proxyEnabled', e.target.checked)}
            />
            {t('mock.proxyEnabled')}
          </label>
        </Field>
        {draft.proxyEnabled && (
          <>
            <Field label={t('mock.proxyTarget')}>
              <input
                type="text"
                value={draft.proxyTarget}
                onChange={(e) => setDraft({ ...draft, proxyTarget: e.target.value })}
                onBlur={() => commit('proxyTarget', draft.proxyTarget)}
                placeholder="https://api.example.com"
                className="w-full rounded border px-2 py-1 font-mono text-sm"
                style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
              />
              <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('mock.proxyHint')}
              </div>
            </Field>
            <Field label="">
              <label
                className="flex cursor-pointer items-center gap-2 text-sm"
                style={{ color: 'var(--text)' }}
              >
                <input
                  type="checkbox"
                  checked={draft.proxyRecord}
                  onChange={(e) => commit('proxyRecord', e.target.checked)}
                />
                {t('mock.proxyRecord')}
              </label>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('mock.proxyRecordHint')}
              </div>
            </Field>
          </>
        )}
      </div>
    </div>
  )
}

/** Generic JSON-blob editor that commits on blur when valid.
 *  When `allowEmpty`, an empty / whitespace-only textarea commits `null`
 *  instead of erroring — useful for optional override fields. */
function JsonConfigField({
  label,
  value,
  onCommit,
  hint,
  rows = 5,
  allowEmpty = false,
}: {
  label: string
  value: unknown
  onCommit: (parsed: unknown) => void
  hint?: string
  rows?: number
  allowEmpty?: boolean
}) {
  // For nullable optional fields we render `null`/`undefined` as an empty
  // textarea (rather than the literal "null") so the placeholder is visible.
  const initial = useMemo(() => {
    if (allowEmpty && (value === null || value === undefined)) return ''
    return JSON.stringify(value, null, 2)
  }, [value, allowEmpty])
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(initial)
    setError(null)
  }, [initial])

  function commit(): void {
    const trimmed = text.trim()
    if (allowEmpty && trimmed === '') {
      onCommit(null)
      setError(null)
      return
    }
    try {
      onCommit(JSON.parse(text))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <label
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={rows}
        className="w-full rounded border px-2 py-1 font-mono text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      />
      {error && (
        <div className="mt-1 text-xs" style={{ color: '#cc2200' }}>
          {error}
        </div>
      )}
      {hint && (
        <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {label && (
        <label
          className="mb-1 block text-[11px] uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {label}
        </label>
      )}
      {children}
    </div>
  )
}

// ─── Logs tab ────────────────────────────────────────────────────

function LogsTab({ serverId }: { serverId: string }) {
  const { t } = useTranslation()
  const logs = useMockStore((s) => s.logsByServer[serverId]) ?? EMPTY_LOGS
  const loadLogs = useMockStore((s) => s.loadLogs)
  const clearLogs = useMockStore((s) => s.clearLogs)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    loadLogs(serverId)
  }, [serverId, loadLogs])

  const selected = logs.find((l) => l.id === selectedId) ?? null

  return (
    <>
      <div
        className="flex w-1/2 shrink-0 flex-col border-r"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className="flex items-center justify-between border-b px-3 py-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {logs.length} {t('mock.entries')}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => loadLogs(serverId)}
              className="rounded border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
              title={t('mock.refresh')}
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={() => clearLogs(serverId)}
              className="rounded border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--white)', color: '#cc2200' }}
            >
              {t('mock.clear')}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {logs.length === 0 ? (
            <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
              {t('mock.noLogs')}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                <tr>
                  <th
                    className="border-b px-2 py-1 text-left"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Time
                  </th>
                  <th
                    className="border-b px-2 py-1 text-left"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Method
                  </th>
                  <th
                    className="border-b px-2 py-1 text-left"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Path
                  </th>
                  <th
                    className="border-b px-2 py-1 text-right"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Status
                  </th>
                  <th
                    className="border-b px-2 py-1 text-right"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    Latency
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs
                  .slice()
                  .reverse()
                  .map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedId(log.id)}
                      style={{
                        cursor: 'pointer',
                        background: selectedId === log.id ? 'var(--accentLight)' : 'transparent',
                      }}
                    >
                      <td
                        className="border-b px-2 py-1"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {new Date(log.ts).toLocaleTimeString()}
                      </td>
                      <td
                        className="border-b px-2 py-1 font-mono"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        {log.method}
                      </td>
                      <td
                        className="border-b px-2 py-1 font-mono truncate"
                        style={{ borderColor: 'var(--border)', maxWidth: 180 }}
                      >
                        {log.path}
                      </td>
                      <td
                        className="border-b px-2 py-1 text-right"
                        style={{ borderColor: 'var(--border)', color: statusColor(log.statusCode) }}
                      >
                        {log.statusCode}
                      </td>
                      <td
                        className="border-b px-2 py-1 text-right"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {log.latencyMs}ms
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto p-3 text-xs">
        {!selected ? (
          <div style={{ color: 'var(--muted)' }}>{t('mock.selectLog')}</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div
                className="text-[11px] uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
              >
                {t('mock.request')}
              </div>
              <div className="font-mono text-xs">
                {selected.method} {selected.path}
                {selected.query ? `?${selected.query}` : ''}
              </div>
              <details>
                <summary className="cursor-pointer mt-1" style={{ color: 'var(--muted)' }}>
                  Headers
                </summary>
                <pre
                  className="m-0 mt-1 rounded border p-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                >
                  {JSON.stringify(selected.request.headers, null, 2)}
                </pre>
              </details>
              {selected.request.body && (
                <details>
                  <summary className="cursor-pointer mt-1" style={{ color: 'var(--muted)' }}>
                    Body
                  </summary>
                  <pre
                    className="m-0 mt-1 rounded border p-2"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                  >
                    {selected.request.body}
                  </pre>
                </details>
              )}
            </div>
            <div>
              <div
                className="text-[11px] uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
              >
                {t('mock.response')}
              </div>
              <div className="font-mono text-xs">
                {selected.statusCode} · {selected.latencyMs}ms
              </div>
              <details>
                <summary className="cursor-pointer mt-1" style={{ color: 'var(--muted)' }}>
                  Headers
                </summary>
                <pre
                  className="m-0 mt-1 rounded border p-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                >
                  {JSON.stringify(selected.response.headers, null, 2)}
                </pre>
              </details>
              <details open>
                <summary className="cursor-pointer mt-1" style={{ color: 'var(--muted)' }}>
                  Body
                </summary>
                <pre
                  className="m-0 mt-1 rounded border p-2 max-h-96 overflow-auto"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                >
                  {selected.response.body}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function statusColor(code: number): string {
  if (code >= 500) return '#7c1fa6'
  if (code >= 400) return '#cc2200'
  if (code >= 300) return '#b35a00'
  if (code >= 200) return '#1a7a4a'
  return '#0066cc'
}
