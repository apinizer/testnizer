/**
 * Mock-server editor opened in the workbench. Tabs: Endpoints / Settings / Logs.
 * Each tab is a self-contained block; settings are saved on blur, endpoints
 * are CRUDed via the store.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { formatClock } from '../../lib/format-datetime'
import { useNumberDraft } from '../../lib/number-draft'
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
import {
  CONDITION_SNIPPETS,
  SCRIPT_SNIPPETS,
  snippetDescriptionKey,
  snippetLabelKey,
  type MockSnippet,
} from '../../lib/mock-snippets'
import { formatCount } from '../../lib/plural'
import JwksFillButton from './JwksFillButton'
import { provisionJwksServe } from '../../lib/jwks-serve'
import { normalizeMockServerKind, type MockServerKind } from '../../../shared/mock-kind'
import MockEditorHeader, { MockStartStopButton, MockUrlLine } from './MockEditorHeader'
import { MockEditorTabButton } from '../mock-mcp/MockMcpEditorTabs'
import { mockSdkBaseUrl, mockServerUrl } from './mock-http-tabs'
import { bodyTypeLabel, bodyTypeOptions, showsHttpEndpointTools } from './mock-kind-ui'
import { MockEndpointOpenInSse, MockSseHeaderButton } from './MockOpenInSse'
import { MockEndpointOpenInHttp } from './MockOpenInHttp'
import MockSseOptions, { MockSseBodyNotes } from './MockSseOptions'
import MockLlmOptions, { MockLlmBodyNotes } from './MockLlmOptions'
import { OptionNumber } from './MockOptionFields'
import { MockAiChatAnthropicButton, MockAiChatHeaderButton } from './MockOpenInAiChat'
import MockServerTypeField from './MockServerTypeField'
import MockEndpointRequestChecks from './MockEndpointRequestChecks'
import { tickerResponse } from './mock-sse-presets'
import { chatResponse } from './mock-ai-presets'
import { buildMockCurl } from './mock-curl'
import { uniqueName } from './mock-create-helpers'
import { SecretLockedNote } from '../shared/SecretStorageNotes'
import { isOpenStreamEntry } from '../../lib/mock-log-streams'
import {
  normalizeLlmConfig,
  normalizeStreamConfig,
  type MockLlmProvider,
} from '../../../shared/mock-stream'

const METHODS: MockMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'QUERY',
  'ANY',
]
const PATH_MODES: MockPathMode[] = ['exact', 'param', 'wildcard', 'regex']
/** Display labels (i18n keys, literal for the key-coverage test); values stay as above. */
const PATH_MODE_LABEL: Record<MockPathMode, string> = {
  exact: 'mock.pathModeOption.exact',
  param: 'mock.pathModeOption.param',
  wildcard: 'mock.pathModeOption.wildcard',
  regex: 'mock.pathModeOption.regex',
}
type EditorTab = 'endpoints' | 'settings' | 'logs'
/** Tab ids + i18n keys (literal so the key-coverage test sees them). */
const EDITOR_TABS: readonly { id: EditorTab; label: string }[] = [
  { id: 'endpoints', label: 'mock.tabEndpoints' },
  { id: 'settings', label: 'mock.tabSettings' },
  { id: 'logs', label: 'mock.tabLogs' },
]
// Body types offered per server kind (json/xml/text/html, sse/json/text, …): `mock-kind-ui.ts`.

// Stable empty references — used as Zustand selector fallbacks so we don't emit
// a new `[]` literal each render and trip React's "Maximum update depth"
// guardrail in useSyncExternalStore.
const EMPTY_ENDPOINTS: readonly MockEndpoint[] = []
const EMPTY_RESPONSES: readonly MockResponse[] = []
const EMPTY_LOGS: readonly MockLogEntry[] = []

export default function MockServerEditor({ serverId }: { serverId: string }) {
  const { t, locale } = useTranslation()
  const server = useMockStore((s) => s.servers.find((x) => x.id === serverId)) ?? null
  const status = useMockStore((s) => s.statusByServer[serverId] ?? 'stopped')
  const error = useMockStore((s) => s.errorByServer[serverId] ?? null)
  const startServer = useMockStore((s) => s.startServer)
  const stopServer = useMockStore((s) => s.stopServer)
  const [tab, setTab] = useState<EditorTab>('endpoints')

  if (!server) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
        {t('mock.serverNotFound')}
      </div>
    )
  }

  const kind = normalizeMockServerKind(server.kind)
  const toggle = async (): Promise<void> => {
    if (status === 'running') {
      await stopServer(serverId)
      return
    }
    const err = await startServer(serverId)
    if (err) toast.error(err)
  }

  return (
    <div
      // Uppercase TR headers ("YANIT ÖNCESİ BETİK") need a Turkish `lang`, or
      // Chromium upper-cases "i" to "I" instead of "İ".
      lang={locale}
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Same header as Mock MCP (MockEditorHeader) — badge, name, status, base URL. */}
      <MockEditorHeader
        kind={kind}
        name={server.name}
        status={status}
        testIdPrefix="mock"
        errorMessage={error}
        actions={
          <>
            <MockStartStopButton
              status={status}
              testIdPrefix="mock"
              onToggle={() => void toggle()}
            />
            {kind === 'sse' && <MockSseHeaderButton server={server} status={status} />}
            {kind === 'ai' && <MockAiChatHeaderButton server={server} status={status} />}
            {kind === 'ai' && <MockAiChatAnthropicButton server={server} status={status} />}
          </>
        }
      >
        <MockUrlLine label={t('mock.baseUrl')} url={mockServerUrl(server)} testId="mock-base-url" />
        {/* AI: what an OpenAI / Anthropic SDK takes as its base URL (§D.3.3). */}
        {kind === 'ai' && (
          <MockUrlLine
            label={t('mock.sdkBaseUrl')}
            url={mockSdkBaseUrl(server)}
            testId="mock-sdk-base-url"
          />
        )}
      </MockEditorHeader>

      {/* Same tab strip as the Mock MCP editor (MockEditorTabButton). */}
      <div
        role="tablist"
        className="flex shrink-0 border-b border-[var(--border)] bg-[var(--white)]"
      >
        {EDITOR_TABS.map(({ id, label }) => (
          <MockEditorTabButton
            key={id}
            testId={`mock-tab-${id}`}
            active={tab === id}
            onClick={() => setTab(id)}
          >
            {t(label)}
          </MockEditorTabButton>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {tab === 'endpoints' && <EndpointsTab serverId={serverId} kind={kind} />}
        {tab === 'settings' && <SettingsTab server={server} kind={kind} />}
        {tab === 'logs' && <LogsTab serverId={serverId} />}
      </div>
    </div>
  )
}

// ─── Endpoints tab ───────────────────────────────────────────────

function EndpointsTab({ serverId, kind }: { serverId: string; kind: MockServerKind }) {
  const { t } = useTranslation()
  const endpoints = useMockStore((s) => s.endpointsByServer[serverId]) ?? EMPTY_ENDPOINTS
  const loadEndpoints = useMockStore((s) => s.loadEndpoints)
  const createEndpoint = useMockStore((s) => s.createEndpoint)
  const createResponse = useMockStore((s) => s.createResponse)
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
    if (kind === 'sse') return addStream()
    if (kind === 'ai') return addChat()
    const ep = await createEndpoint({
      serverId,
      method: 'GET',
      path: '/new-endpoint',
      pathMode: 'exact',
    })
    if (ep) setActiveId(ep.id)
  }

  /**
   * SSE server (issue #221): GET /events (or /events-2 …) with the Ticker
   * preset's response. The response is created BEFORE the endpoint is
   * selected, so the editor's first load already sees it.
   */
  async function addStream(): Promise<void> {
    const path = uniqueName(
      '/events',
      endpoints.map((e) => e.path),
      '-',
    )
    const ep = await createEndpoint({ serverId, method: 'GET', path, pathMode: 'exact' })
    if (!ep) return
    await createResponse({
      endpointId: ep.id,
      ...tickerResponse(),
      script: '',
      order: 0,
      enabled: true,
    })
    setActiveId(ep.id)
  }

  /**
   * AI server (issue #221): POST /v1/chat/completions with the Chat preset's
   * OpenAI reply; taken → POST /v1/messages with the Anthropic reply; both
   * taken → the plain POST /new-endpoint with no response.
   */
  async function addChat(): Promise<void> {
    const taken = new Set(endpoints.map((e) => e.path))
    const pick: { path: string; provider: MockLlmProvider | null } = !taken.has(
      '/v1/chat/completions',
    )
      ? { path: '/v1/chat/completions', provider: 'openai' }
      : !taken.has('/v1/messages')
        ? { path: '/v1/messages', provider: 'anthropic' }
        : { path: '/new-endpoint', provider: null }
    const ep = await createEndpoint({
      serverId,
      method: 'POST',
      path: pick.path,
      pathMode: 'exact',
    })
    if (!ep) return
    if (pick.provider) {
      await createResponse({
        endpointId: ep.id,
        ...chatResponse(pick.provider),
        script: '',
        order: 0,
        enabled: true,
      })
    }
    setActiveId(ep.id)
  }

  /**
   * #61 JWKS-serve: publish a built JWKS at `/.well-known/jwks.json`.
   *
   * ZERO new mock primitives (reconcile D1-1) — it is one ordinary endpoint row
   * plus one response row, created through the SAME store actions the Add
   * button uses. Rotation is just filling the body again (D1-2): the response
   * update hot-reloads a running server.
   */
  async function handleServeJwks(body: string): Promise<void> {
    try {
      const { endpoint } = await provisionJwksServe({
        serverId,
        body,
        createEndpoint,
        createResponse,
      })
      setActiveId(endpoint.id)
    } catch (e) {
      setImportStatus(e instanceof Error ? e.message : String(e))
    }
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
      const n = result.warnings.length
      const warn =
        n > 0 ? ` (${formatCount(n, t('mock.warningCountOne'), t('mock.warningCount'))})` : ''
      const endpoints = formatCount(
        result.endpointsCreated,
        t('mock.importEndpointCountOne'),
        t('mock.importEndpointCount'),
      )
      const responses = formatCount(
        result.responsesCreated,
        t('mock.importResponseCountOne'),
        t('mock.importResponseCount'),
      )
      toast.success(
        t('mock.importDone')
          .replace('{endpoints}', endpoints)
          .replace('{responses}', responses)
          .replace('{warnings}', warn),
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
          {/* Labels stay on one line (TR is longer): the GROUP wraps, never a
              button's text (G-07). */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('mock.endpoints')}
            </span>
            <button
              onClick={handleAdd}
              data-testid="mock-add-endpoint"
              className="flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              <Plus size={12} /> {t('mock.add')}
            </button>
            {/* #61: publish a JWKS at the well-known path. One ordinary
                endpoint + response row, created through the same store
                actions — no new mock primitive. HTTP servers only. */}
            {showsHttpEndpointTools(kind) && (
              <JwksFillButton
                body=""
                onFill={(built) => void handleServeJwks(built)}
                label={t('mock.jwksServe')}
                testId="mock-jwks-serve"
              />
            )}
          </div>
          {showsHttpEndpointTools(kind) && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => handleImport('openapi')}
                data-testid="mock-import-openapi"
                className="flex-1 whitespace-nowrap rounded border px-2 py-0.5 text-[11px]"
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
                data-testid="mock-import-postman"
                className="flex-1 whitespace-nowrap rounded border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                  background: 'var(--white)',
                }}
              >
                {t('mock.importPostman')}
              </button>
            </div>
          )}
          {importStatus && (
            <div className="text-[11px]" style={{ color: 'var(--accent-text)' }}>
              {importStatus}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {endpoints.length === 0 ? (
            <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
              {kind === 'sse'
                ? t('mock.noStreams')
                : kind === 'ai'
                  ? t('mock.noChatEndpoints')
                  : t('mock.noEndpoints')}
            </div>
          ) : (
            endpoints.map((ep) => (
              <div
                key={ep.id}
                onClick={() => setActiveId(ep.id)}
                className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-xs"
                style={{
                  borderColor: 'var(--border)',
                  background: activeId === ep.id ? 'var(--accent-light)' : 'transparent',
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
            kind={kind}
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
        typeLabel={t('deleteConfirm.type.endpoint')}
        onConfirm={() => {
          if (deleteTarget) deleteEndpoint(serverId, deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}

/** Method pill — the app-wide `--mb-*` method tokens, so dark mode follows. ANY → neutral. */
const TOKEN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'])
function methodStyle(method: string): React.CSSProperties {
  if (!TOKEN_METHODS.has(method)) {
    return { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }
  }
  const m = method.toLowerCase()
  return {
    background: `var(--mb-${m}-bg)`,
    color: `var(--mb-${m}-fg)`,
    border: `1px solid var(--mb-${m}-br)`,
  }
}

// ─── Endpoint editor ─────────────────────────────────────────────

function EndpointEditor({
  serverId,
  endpoint,
  kind,
}: {
  serverId: string
  endpoint: MockEndpoint
  kind: MockServerKind
}) {
  // Draft-based so the box can be cleared; `Number('') || 0` used to slam a 0
  // back in and the next digit landed beside it.
  const priorityDraft = useNumberDraft({
    value: endpoint.priority,
    min: 0,
    max: 9999,
    onChange: (v) => updateEndpoint(endpoint.id, { priority: v }),
  })
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
            data-testid="mock-endpoint-method"
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
            data-testid="mock-endpoint-path"
            className="rounded border px-2 py-1 font-mono text-sm"
            style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
          />
        </div>

        <FullUrlBar
          server={server}
          status={status}
          endpoint={endpoint}
          streams={responses.some((r) => r.bodyType === 'sse')}
          llm={llmProviderOf(responses)}
        />

        {/* Wraps in a narrow editor; no label breaks inside (issue #226). */}
        <div
          data-testid="mock-endpoint-options-row"
          className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs"
        >
          <label
            className="flex items-center gap-1.5 whitespace-nowrap"
            style={{ color: 'var(--muted)' }}
          >
            {t('mock.pathMode')}:
            <select
              data-testid="mock-endpoint-path-mode"
              value={endpoint.pathMode}
              onChange={(e) =>
                updateEndpoint(endpoint.id, { pathMode: e.target.value as MockPathMode })
              }
              className="rounded border px-2 py-1"
              style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
            >
              {/* Value = the stored mode; the label is translated (G-12). */}
              {PATH_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(PATH_MODE_LABEL[m])}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={endpoint.enabled}
              onChange={(e) => updateEndpoint(endpoint.id, { enabled: e.target.checked })}
            />
            {t('mock.enabled')}
          </label>
          <OptionNumber
            label={t('mock.priority')}
            testId="mock-endpoint-priority"
            draft={priorityDraft}
          />
        </div>

        <MockEndpointRequestChecks
          kind={kind}
          configured={
            !!endpoint.authOverride || !!endpoint.schemaValidation || !!endpoint.authDecryptFailed
          }
        >
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
        </MockEndpointRequestChecks>
        {endpoint.authDecryptFailed && (
          <SecretLockedNote testId="mock-endpoint-auth-decrypt-failed" className="mt-1" />
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--heading)' }}>
            {t('mock.responses')}
          </h3>
          <button
            onClick={handleAddResponse}
            data-testid="mock-add-response"
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
                    background: activeRespId === r.id ? 'var(--accent-light)' : 'var(--white)',
                    color: activeRespId === r.id ? 'var(--accent-text)' : 'var(--text)',
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
                kind={kind}
                projectId={server?.projectId}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Full URL bar (Copy / Copy as cURL / Open in request tab) ─────

function FullUrlBar({
  server,
  status,
  endpoint,
  streams,
  llm,
}: {
  server: MockServer | null
  status: string
  endpoint: MockEndpoint
  /** The endpoint has an `sse` response → offer "Open in SSE tab" (issue #221). */
  streams: boolean
  /** Provider of the endpoint's `llm` response → an LLM chat cURL (issue #221). */
  llm: MockLlmProvider | null
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'' | 'url' | 'curl'>('')

  if (!server) return null

  const fullUrl = `http://${server.host}:${server.port}${server.basePath}${endpoint.path}`

  const curl = buildMockCurl(server, endpoint, llm)

  async function copy(kind: 'url' | 'curl', text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* ignore */
    }
  }

  // Narrow editor (issue #226): the URL box keeps a minimum width and
  // truncates; the buttons are one group that wraps onto the next line as a
  // whole, each label on one line.
  return (
    <div
      data-testid="mock-endpoint-url-bar"
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded border px-2 py-1.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div
        data-testid="mock-endpoint-url-box"
        className="flex min-w-[12rem] flex-1 items-center gap-2"
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          URL
        </span>
        <code
          className="min-w-0 flex-1 truncate font-mono text-xs"
          style={{ color: 'var(--text)' }}
          title={fullUrl}
          data-testid="mock-endpoint-url"
        >
          {fullUrl}
        </code>
      </div>
      <div
        data-testid="mock-endpoint-url-actions"
        className="flex max-w-full min-w-0 flex-wrap items-center gap-2"
      >
        {status !== 'running' && (
          <span
            data-testid="mock-endpoint-not-running"
            className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px]"
            style={{
              background: 'var(--mb-delete-bg)',
              color: 'var(--red)',
              border: '1px solid var(--mb-delete-br)',
            }}
            title={t('mock.startServerToTest')}
          >
            {t('mock.notRunning')}
          </span>
        )}
        <button
          onClick={() => copy('url', fullUrl)}
          className="whitespace-nowrap rounded border px-2 py-0.5 text-[11px]"
          style={{
            borderColor: 'var(--border)',
            color: copied === 'url' ? 'var(--green)' : 'var(--muted)',
            background: 'var(--white)',
          }}
          title={t('mock.copyUrl')}
        >
          {copied === 'url' ? '✓' : '⧉'} {t('mock.copyUrl')}
        </button>
        <button
          data-testid="mock-copy-curl"
          onClick={() => copy('curl', curl)}
          className="whitespace-nowrap rounded border px-2 py-0.5 text-[11px]"
          style={{
            borderColor: 'var(--border)',
            color: copied === 'curl' ? 'var(--green)' : 'var(--muted)',
            background: 'var(--white)',
          }}
          title={t('mock.copyCurl')}
        >
          {copied === 'curl' ? '✓' : '⧉'} cURL
        </button>
        <MockEndpointOpenInHttp
          server={server}
          endpoint={endpoint}
          status={status}
          llm={llm}
          streams={streams}
        />
        {streams && <MockEndpointOpenInSse server={server} endpoint={endpoint} status={status} />}
      </div>
    </div>
  )
}

/** Provider of the first `llm` response of an endpoint, or null (cURL shape, issue #221). */
function llmProviderOf(responses: readonly MockResponse[]): MockLlmProvider | null {
  const r = responses.find((x) => x.bodyType === 'llm')
  return r ? normalizeLlmConfig(r.streamConfig).provider : null
}

/**
 * The settings a response gets when its body type changes (issue #221):
 * the new type's defaults, in the SAME update as the type — `stream_config`
 * means something else per type, and a leftover of the old type would be
 * read (or rejected) as the new one's.
 */
function freshStreamConfig(bodyType: MockBodyType): MockResponse['streamConfig'] {
  if (bodyType === 'sse') return normalizeStreamConfig(null)
  if (bodyType === 'llm') return normalizeLlmConfig(null)
  return null
}

// ─── Response editor ─────────────────────────────────────────────

function ResponseEditor({
  response,
  endpointId,
  kind,
  projectId,
}: {
  response: MockResponse
  endpointId: string
  /** Server kind — picks the body types offered (issue #221). */
  kind: MockServerKind
  /** Lets the JWKS fill offer the project's saved certificate rows. */
  projectId?: string
}) {
  const { t } = useTranslation()
  const updateResponse = useMockStore((s) => s.updateResponse)
  const deleteResponse = useMockStore((s) => s.deleteResponse)
  const statusDraft = useNumberDraft({
    value: response.statusCode,
    min: 100,
    max: 599,
    onChange: (v) => updateResponse(response.id, { statusCode: v }),
  })
  const delayDraft = useNumberDraft({
    value: response.delayMs,
    min: 0,
    max: 600000,
    onChange: (v) => updateResponse(response.id, { delayMs: v }),
  })
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
      {/*
        Status / name / body type / delete. Every track has a fixed rem minimum
        — a plain `1fr` track's minimum is `auto`, the input's intrinsic width,
        which pushed the select and the delete button out of a narrow editor
        (issue #226). Status is capped at 6rem and the type at 10rem so the name —
        the free text — gets the room (PM review #18); in a narrow editor all
        three shrink toward their minimums.
      */}
      <div
        data-testid="mock-response-row"
        className="mb-2 grid grid-cols-[minmax(4.5rem,6rem)_minmax(7rem,1fr)_minmax(7rem,10rem)_auto] gap-2"
      >
        <input
          type="number"
          {...statusDraft.inputProps}
          data-testid="mock-response-status"
          className="w-full min-w-0 rounded border px-2 py-1 text-sm"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
        <input
          type="text"
          value={response.name}
          onChange={(e) => updateResponse(response.id, { name: e.target.value })}
          placeholder={t('mock.responseName')}
          title={response.name || undefined}
          data-testid="mock-response-name"
          className="w-full min-w-0 rounded border px-2 py-1 text-sm"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
        <select
          value={response.bodyType}
          onChange={(e) => {
            const bodyType = e.target.value as MockBodyType
            updateResponse(response.id, { bodyType, streamConfig: freshStreamConfig(bodyType) })
          }}
          data-testid="mock-response-body-type"
          className="w-full min-w-0 rounded border px-2 py-1 text-xs"
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        >
          {bodyTypeOptions(kind, response.bodyType).map((b) => (
            <option key={b} value={b}>
              {bodyTypeLabel(t, b)}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (confirm(t('mock.confirmDeleteResponse'))) deleteResponse(endpointId, response.id)
          }}
          data-testid="mock-response-delete"
          title={t('mock.deleteResponse')}
          aria-label={t('mock.deleteResponse')}
          className="rounded border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--red)', background: 'var(--white)' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <OptionNumber label={t('mock.delayMs')} testId="mock-response-delay" draft={delayDraft} />
        <label
          className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap"
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

      {response.bodyType === 'sse' && <MockSseOptions response={response} />}
      {response.bodyType === 'llm' && <MockLlmOptions response={response} />}

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
        {/*
          The JWKS auto-fill (#61) is ONE ADDED button that writes into the SAME
          body field below — never a replacement for hand-authoring, which keeps
          working byte-for-byte.
        */}
        <div className="mb-1 flex items-center justify-between">
          <label
            className="block text-[11px] uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            {t('mock.body')}
          </label>
          {/* Only offered where a JWKS could actually live: on an XML or text
              response the button would replace the body with JSON. */}
          {/* HTTP servers only, like "Serve JWKS" (PM review #17): an SSE side
              endpoint or an AI error body has no use for a key set. */}
          {response.bodyType === 'json' && showsHttpEndpointTools(kind) && (
            <JwksFillButton
              body={response.body}
              projectId={projectId}
              onFill={(body) => updateResponse(response.id, { body })}
            />
          )}
        </div>
        <div
          data-testid="mock-response-body"
          style={{ height: 200, border: '1px solid var(--border)', borderRadius: 4 }}
        >
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
        {response.bodyType === 'sse' && <MockSseBodyNotes body={response.body} />}
        {response.bodyType === 'llm' && (
          <MockLlmBodyNotes provider={normalizeLlmConfig(response.streamConfig).provider} />
        )}
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
          <div className="mt-1 text-xs" style={{ color: 'var(--red)' }}>
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

/**
 * Compact dropdown that inserts a chosen snippet body into the parent editor.
 * Names / descriptions are translated here, at render time (issue #309); the
 * option value stays the array index and the body is the untranslated code.
 */
function SnippetPicker({
  label,
  snippets,
  onPick,
}: {
  label: string
  snippets: MockSnippet[]
  onPick: (body: string) => void
}) {
  const { t } = useTranslation()
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
        color: 'var(--accent-text)',
        maxWidth: 220,
      }}
      title={label}
    >
      <option value="">{label}</option>
      {snippets.map((s, i) => (
        <option key={s.id} value={i} title={t(snippetDescriptionKey(s))}>
          {t(snippetLabelKey(s))}
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
  const { t } = useTranslation()
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
            placeholder={t('mock.name')}
            className="rounded border px-2 py-1 text-xs"
            style={{ width: 200, background: 'var(--white)', borderColor: 'var(--border)' }}
          />
          <input
            type="text"
            value={h.value}
            onChange={(e) =>
              onChange(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
            placeholder={t('kv.value')}
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
          color: 'var(--accent-text)',
          background: 'var(--white)',
        }}
      >
        {t('kv.addHeader')}
      </button>
    </div>
  )
}

// ─── Settings tab ────────────────────────────────────────────────

function SettingsTab({ server, kind }: { server: MockServer; kind: MockServerKind }) {
  const { t } = useTranslation()
  const updateServer = useMockStore((s) => s.updateServer)
  const [draft, setDraft] = useState(server)

  useEffect(() => setDraft(server), [server])

  function commit<K extends keyof MockServer>(k: K, v: MockServer[K]): void {
    setDraft((d) => ({ ...d, [k]: v }))
    updateServer(server.id, { [k]: v })
  }

  // The port box could not be cleared at all: emptying it wrote 0, so a new port
  // had to be typed around the zero.
  const portDraft = useNumberDraft({
    value: draft.port,
    min: 1,
    max: 65535,
    onChange: (v) => setDraft((d) => ({ ...d, port: v })),
  })
  const corsDraft = useNumberDraft({
    value: draft.corsMaxAge,
    min: 0,
    max: 86400,
    onChange: (v) => setDraft((d) => ({ ...d, corsMaxAge: v })),
  })

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
        {/* Issue #222: the type picked at creation, changeable here. */}
        <Field label={t('mock.serverType')}>
          <MockServerTypeField server={server} />
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
              <div className="mt-1 text-xs" style={{ color: 'var(--orange)' }}>
                ⚠ {t('mock.publicWarning')}
              </div>
            )}
          </Field>
          <Field label={t('mock.port')}>
            <input
              type="number"
              {...portDraft.inputProps}
              onBlur={() => {
                portDraft.inputProps.onBlur()
                commit('port', draft.port)
              }}
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
          {/* AI: the SDK base URL the header shows, and that auth is off by default (§D.3.3). */}
          {kind === 'ai' && (
            <div
              className="mt-1 text-[11px]"
              style={{ color: 'var(--muted)' }}
              data-testid="mock-settings-ai-hint"
            >
              {t('mock.aiSettingsHint').replace('{url}', mockSdkBaseUrl(server))}
            </div>
          )}
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
                  {...corsDraft.inputProps}
                  onBlur={() => {
                    corsDraft.inputProps.onBlur()
                    commit('corsMaxAge', draft.corsMaxAge)
                  }}
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
        {server.authDecryptFailed && (
          <SecretLockedNote testId="mock-auth-decrypt-failed" className="mt-1" />
        )}

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
        <div className="mt-1 text-xs" style={{ color: 'var(--red)' }}>
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
  const { t, locale } = useTranslation()
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
          <span data-testid="mock-log-count" className="text-xs" style={{ color: 'var(--muted)' }}>
            {formatCount(logs.length, t('mock.entryCountOne'), t('mock.entryCount'))}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => loadLogs(serverId)}
              className="rounded border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
              title={t('mock.refresh')}
              aria-label={t('mock.refresh')}
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={() => clearLogs(serverId)}
              className="rounded border px-2 py-0.5 text-xs"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--red)',
              }}
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
                    {t('mock.logTime')}
                  </th>
                  <th
                    className="border-b px-2 py-1 text-left"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    {t('mock.logMethod')}
                  </th>
                  <th
                    className="border-b px-2 py-1 text-left"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    {t('mock.logPath')}
                  </th>
                  <th
                    className="border-b px-2 py-1 text-right"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    {t('mock.logStatus')}
                  </th>
                  <th
                    className="border-b px-2 py-1 text-right"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                  >
                    {t('mock.logLatency')}
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
                      data-testid="mock-log-row"
                      // One row per stream: "open" until its closed entry replaces it (issue #226).
                      data-streaming={isOpenStreamEntry(log) ? 'true' : 'false'}
                      onClick={() => setSelectedId(log.id)}
                      style={{
                        cursor: 'pointer',
                        background: selectedId === log.id ? 'var(--accent-light)' : 'transparent',
                      }}
                    >
                      <td
                        className="border-b px-2 py-1"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {formatClock(log.ts, locale)}
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
                        data-testid="mock-log-latency"
                        className="border-b px-2 py-1 text-right"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        <LogLatency log={log} />
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
                  {t('mock.headers')}
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
                    {t('mock.body')}
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
                {selected.statusCode} · <LogLatency log={selected} />
              </div>
              <details>
                <summary className="cursor-pointer mt-1" style={{ color: 'var(--muted)' }}>
                  {t('mock.headers')}
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
                  {t('mock.body')}
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

/** "142ms", or "streaming…" while a stream's closed entry has not arrived (issue #226). */
function LogLatency({ log }: { log: MockLogEntry }) {
  const { t } = useTranslation()
  if (!isOpenStreamEntry(log)) return <>{log.latencyMs}ms</>
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      style={{ color: 'var(--green)' }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
      {t('mock.logStreaming')}
    </span>
  )
}

function statusColor(code: number): string {
  if (code >= 500) return '#7c1fa6'
  if (code >= 400) return 'var(--red)'
  if (code >= 300) return 'var(--orange)'
  if (code >= 200) return 'var(--green)'
  return 'var(--blue)'
}
