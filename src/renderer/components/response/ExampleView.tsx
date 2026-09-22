import { useEffect, useMemo, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { parseRequestSnapshot } from '../../stores/saved-response.store'
import { useTranslation } from '../../lib/i18n'
import MethodBadge from '../shared/MethodBadge'
import StatusBadge from '../shared/StatusBadge'
import ResponsePane from './ResponsePane'
import type { ApiResponse, KeyValuePair, SavedRequestSnapshot, SavedResponse } from '../../types'

type Mode = 'sent' | 'original'

interface ExampleViewProps {
  tabId: string
  savedResponseId: string
}

/**
 * Read-only view of a saved example (issue #125 follow-up): the request that
 * was sent on that run — resolved by default, the `{{var}}` template on
 * demand — above the response that came back. Lives in its own tab so the
 * owner request's live editor is never overwritten.
 *
 * The response half is the regular ResponsePane: the saved snapshot is
 * written into THIS tab's response slice (responses are per tab, issue #76),
 * so body/headers/cookies/tests render exactly as they would after Send.
 */
export default function ExampleView({ tabId, savedResponseId }: ExampleViewProps) {
  const { t } = useTranslation()
  const closeTab = useTabsStore((s) => s.closeTab)
  const [item, setItem] = useState<SavedResponse | null>(null)
  // `actualRequest` from the response snapshot — the Sent view's fallback for
  // rows saved before request_json existed. Captured here so render never
  // reads the response store non-reactively.
  const [sentFallback, setSentFallback] = useState<ApiResponse['actualRequest']>(undefined)
  const [missing, setMissing] = useState(false)
  const [mode, setMode] = useState<Mode>('sent')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = (await window.api?.savedResponse?.get(savedResponseId)) as
          | { success: boolean; data?: SavedResponse; error?: string }
          | undefined
        if (cancelled) return
        if (!res?.success || !res.data) {
          setMissing(true)
          return
        }
        let snap: Partial<ApiResponse> = {}
        try {
          snap = JSON.parse(res.data.response_json) as Partial<ApiResponse>
        } catch {
          snap = {}
        }
        setSentFallback(snap.actualRequest)
        setItem(res.data)
        useResponseStore.getState().setResponse(
          {
            requestId: `saved-${res.data.id}`,
            protocol: (snap.protocol || res.data.protocol || 'http') as ApiResponse['protocol'],
            status: snap.status ?? res.data.status_code ?? undefined,
            statusText: snap.statusText,
            headers: snap.headers,
            body: snap.body,
            bodyEncoding: snap.bodyEncoding,
            bodySize: snap.bodySize,
            timing: snap.timing || { total: 0 },
            error: snap.error,
            cookies: snap.cookies,
            testResults: snap.testResults,
            actualRequest: snap.actualRequest,
          },
          tabId,
        )
      } catch {
        if (!cancelled) setMissing(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [savedResponseId, tabId])

  const snapshot = useMemo(() => parseRequestSnapshot(item?.request_json), [item])
  // Rows saved before request_json existed still carry `actualRequest`
  // inside the response snapshot — enough for the Sent view.
  const sent = snapshot?.sent ?? sentFallback

  if (missing) {
    return (
      <div
        data-testid="example-view-missing"
        className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--white)] text-[var(--muted)]"
      >
        <Bookmark size={28} />
        <span>{t('example.deleted')}</span>
        <button
          type="button"
          onClick={() => closeTab(tabId)}
          className="rounded border border-[var(--border)] px-3 py-1 text-[var(--text)] hover:bg-[var(--hover)]"
        >
          {t('example.closeTab')}
        </button>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--white)] text-[var(--muted)]">
        {t('example.loading')}
      </div>
    )
  }

  const effectiveMode: Mode = snapshot ? mode : 'sent'

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[var(--white)]"
      data-testid="example-view"
    >
      {/* Banner */}
      <div
        data-testid="example-banner"
        className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5"
        style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
      >
        <Bookmark size={13} />
        <span className="font-semibold">{item.name}</span>
        {item.status_code != null && <StatusBadge status={item.status_code} />}
        <span className="text-[var(--muted)]">·</span>
        <span className="text-[var(--muted)]">{t('example.banner')}</span>
        <span className="ml-auto text-[var(--muted)]">
          {t('example.savedAt').replace('{date}', new Date(item.created_at).toLocaleString())}
        </span>
      </div>

      <PanelGroup direction="vertical" autoSaveId="example-view-split">
        <Panel defaultSize={45} minSize={15}>
          <div className="flex h-full flex-col overflow-hidden">
            {/* Request header: mode toggle + method + URL */}
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
              <span className="font-semibold text-[var(--sub)]">{t('example.request')}</span>
              <div className="flex overflow-hidden rounded border border-[var(--border)]">
                <ModeButton
                  active={effectiveMode === 'sent'}
                  onClick={() => setMode('sent')}
                  label={t('example.sent')}
                  title={t('example.sentHint')}
                  testId="example-mode-sent"
                />
                <ModeButton
                  active={effectiveMode === 'original'}
                  onClick={() => setMode('original')}
                  label={t('example.original')}
                  title={t('example.originalHint')}
                  testId="example-mode-original"
                  disabled={!snapshot}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {effectiveMode === 'sent' ? (
                <SentRequest sent={sent} fallbackMethod={item.method} fallbackUrl={item.url} />
              ) : (
                <OriginalRequest configured={snapshot!.configured} />
              )}
              {!snapshot && (
                <p className="mt-2 text-[var(--hint)]" data-testid="example-no-request-snapshot">
                  {t('example.noRequestSnapshot')}
                </p>
              )}
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="h-[3px] bg-[var(--border)] hover:bg-[var(--accent)]" />
        <Panel defaultSize={55} minSize={15}>
          <ResponsePane />
        </Panel>
      </PanelGroup>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  title,
  testId,
  disabled,
}: {
  active: boolean
  onClick: () => void
  label: string
  title: string
  testId: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-0.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'white' : 'var(--sub)',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

/** Text with any leftover `{{var}}` highlighted red, like UrlPreview. */
function VarText({ text }: { text: string }) {
  const re = /\{\{[^}]+\}\}/g
  const parts: Array<{ text: string; unresolved: boolean }> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), unresolved: false })
    parts.push({ text: m[0], unresolved: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), unresolved: false })
  return (
    <>
      {parts.map((p, i) =>
        p.unresolved ? (
          <span key={i} style={{ color: 'var(--red)' }}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--hint)]">
        {title}
      </div>
      {children}
    </div>
  )
}

function KvTable({ rows, testId }: { rows: Array<[string, string]>; testId: string }) {
  const { t } = useTranslation()
  if (rows.length === 0) return <div className="text-[var(--hint)]">—</div>
  return (
    <table className="w-full border-collapse font-mono text-[12px]" data-testid={testId}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-b border-[var(--border)]">
            <td className="py-0.5 pr-3 align-top text-[var(--sub)]">{k}</td>
            <td className="py-0.5 break-all text-[var(--text)]" title={t('example.headers')}>
              <VarText text={v} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BodyBlock({ body, testId }: { body: string | undefined; testId: string }) {
  const { t } = useTranslation()
  if (!body) return <div className="text-[var(--hint)]">{t('example.noBody')}</div>
  return (
    <pre
      data-testid={testId}
      className="max-h-[40vh] overflow-auto rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[12px] whitespace-pre-wrap break-all text-[var(--text)]"
    >
      <VarText text={body} />
    </pre>
  )
}

function SentRequest({
  sent,
  fallbackMethod,
  fallbackUrl,
}: {
  sent: SavedRequestSnapshot['sent'] | undefined
  fallbackMethod: string | null
  fallbackUrl: string | null
}) {
  const { t } = useTranslation()
  const method = sent?.method || fallbackMethod || 'GET'
  const url = sent?.url || fallbackUrl || ''
  return (
    <div data-testid="example-request-sent">
      <div className="mb-3 flex items-center gap-2 font-mono text-[12px]">
        <MethodBadge method={method} small />
        <span className="break-all text-[var(--text)]" data-testid="example-sent-url">
          <VarText text={url} />
        </span>
      </div>
      {!sent && <p className="mb-2 text-[var(--hint)]">{t('example.noSentSnapshot')}</p>}
      <Section title={t('example.headers')}>
        <KvTable rows={Object.entries(sent?.headers ?? {})} testId="example-sent-headers" />
      </Section>
      <Section title={t('example.body')}>
        <BodyBlock body={sent?.body} testId="example-sent-body" />
      </Section>
    </div>
  )
}

function enabledPairs(pairs: KeyValuePair[] | undefined): Array<[string, string]> {
  return (pairs ?? []).filter((p) => p.enabled && p.key).map((p) => [p.key, p.value])
}

function OriginalRequest({ configured }: { configured: SavedRequestSnapshot['configured'] }) {
  const { t } = useTranslation()
  const body = configured.body
  const bodyText =
    body?.type === 'form-data' || body?.type === 'urlencoded'
      ? (body.formData ?? body.urlEncoded ?? [])
          .filter((p) => p.enabled)
          .map((p) => `${p.key}=${p.value}`)
          .join('\n')
      : body?.content
  return (
    <div data-testid="example-request-original">
      <div className="mb-3 flex items-center gap-2 font-mono text-[12px]">
        <MethodBadge method={configured.method || 'GET'} small />
        <span className="break-all text-[var(--text)]" data-testid="example-original-url">
          <VarText text={configured.url || ''} />
        </span>
      </div>
      <Section title={t('example.params')}>
        <KvTable rows={enabledPairs(configured.params)} testId="example-original-params" />
      </Section>
      <Section title={t('example.headers')}>
        <KvTable rows={enabledPairs(configured.headers)} testId="example-original-headers" />
      </Section>
      <Section title={t('example.body')}>
        <BodyBlock body={bodyText} testId="example-original-body" />
      </Section>
    </div>
  )
}
