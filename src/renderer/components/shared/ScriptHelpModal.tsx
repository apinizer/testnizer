import { X } from 'lucide-react'
import Modal from './Modal'
import { useTranslation } from '../../lib/i18n'

interface ScriptHelpModalProps {
  open: boolean
  onClose: () => void
  /** 'pre' adjusts copy + ordering for pre-request scripts (e.g. `pm.response`
   *  is not available before the request fires). */
  variant?: 'pre' | 'post'
  /** The script belongs to an MCP request: show the `pm.mcp` section (post-response only). */
  isMcp?: boolean
}

interface Snippet {
  titleKey: string
  code: string
}

const RESPONSE_SNIPPETS: Snippet[] = [
  {
    titleKey: 'scriptHelp.snippet.statusCheck',
    code: `pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200)
})`,
  },
  {
    titleKey: 'scriptHelp.snippet.jsonBody',
    code: `const data = pm.response.json()
pm.test("Has id field", () => {
  pm.expect(data.id).to.exist
})`,
  },
  {
    titleKey: 'scriptHelp.snippet.header',
    code: `pm.test("JSON content type", () => {
  const ct = pm.response.headers.get("content-type")
  pm.expect(ct).to.include("application/json")
})`,
  },
  {
    titleKey: 'scriptHelp.snippet.responseTime',
    code: `pm.test("Fast enough", () => {
  pm.expect(pm.response.responseTime).to.be.below(500)
})`,
  },
]

const ENV_SNIPPETS: Snippet[] = [
  {
    titleKey: 'scriptHelp.snippet.envSet',
    code: `// Persist a value for the next request
const token = pm.response.json().token
pm.environment.set("authToken", token)`,
  },
  {
    titleKey: 'scriptHelp.snippet.envGet',
    code: `// Read an env / global / collection var
const baseUrl = pm.environment.get("baseUrl")
const apiKey  = pm.globals.get("apiKey")`,
  },
  {
    titleKey: 'scriptHelp.snippet.envCondition',
    code: `// Drive logic from variables
if (pm.environment.get("env") === "prod") {
  pm.test("prod must be 2xx", () => {
    pm.expect(pm.response.code).to.be.below(300)
  })
}`,
  },
]

const PRE_SNIPPETS: Snippet[] = [
  {
    titleKey: 'scriptHelp.snippet.preSetVar',
    code: `// Set a request-time variable
pm.environment.set("nowMs", Date.now())`,
  },
  {
    titleKey: 'scriptHelp.snippet.preSkip',
    code: `// Conditionally skip this request
if (!pm.environment.get("authToken")) {
  pm.execution.skipRequest()
}`,
  },
]

/**
 * MCP requests (issue #160) run the same post-response scripts; `pm.response`
 * is the HTTP-shaped view of the result and `pm.mcp` the MCP one
 * (`src/shared/mcp-response.ts`, the same on Send and Run).
 */
const MCP_SNIPPETS: Snippet[] = [
  {
    titleKey: 'scriptHelp.snippet.mcpSucceeded',
    code: `pm.test('tool succeeded', () => pm.expect(pm.mcp.isError).to.be.false)`,
  },
  {
    titleKey: 'scriptHelp.snippet.mcpChain',
    code: `// Chain calls: keep a value from this result for the next request
pm.environment.set('libraryId', pm.response.json().libraryId)
// Same data without the HTTP view: pm.mcp.structuredContent.libraryId`,
  },
]

const MCP_API_ROWS: ApiRow[] = [
  { expr: 'pm.mcp.isError', descKey: 'scriptHelp.api.mcpIsError' },
  { expr: 'pm.mcp.result', descKey: 'scriptHelp.api.mcpResult' },
  { expr: 'pm.mcp.structuredContent', descKey: 'scriptHelp.api.mcpStructured' },
  { expr: 'pm.mcp.content', descKey: 'scriptHelp.api.mcpContent' },
  { expr: 'pm.mcp.capability / .name', descKey: 'scriptHelp.api.mcpCapability' },
]

interface ApiRow {
  expr: string
  descKey: string
}

const API_ROWS: ApiRow[] = [
  { expr: 'pm.response.code', descKey: 'scriptHelp.api.responseCode' },
  { expr: 'pm.response.status', descKey: 'scriptHelp.api.responseStatus' },
  { expr: 'pm.response.json()', descKey: 'scriptHelp.api.responseJson' },
  { expr: 'pm.response.text()', descKey: 'scriptHelp.api.responseText' },
  { expr: 'pm.response.headers.get(name)', descKey: 'scriptHelp.api.responseHeader' },
  { expr: 'pm.response.responseTime', descKey: 'scriptHelp.api.responseTime' },
  { expr: 'pm.response.responseSize', descKey: 'scriptHelp.api.responseSize' },
  { expr: 'pm.request.method / .url / .headers', descKey: 'scriptHelp.api.request' },
  { expr: 'pm.environment.set / get / has', descKey: 'scriptHelp.api.environment' },
  { expr: 'pm.globals.set / get / has', descKey: 'scriptHelp.api.globals' },
  { expr: 'pm.variables.set / get', descKey: 'scriptHelp.api.variables' },
  { expr: 'pm.test(name, fn)', descKey: 'scriptHelp.api.test' },
  {
    expr: 'pm.expect(value).to.equal / .include / .exist / .below',
    descKey: 'scriptHelp.api.expect',
  },
  { expr: 'pm.execution.skipRequest()', descKey: 'scriptHelp.api.skip' },
  { expr: 'console.log / warn / error', descKey: 'scriptHelp.api.console' },
]

function CodeBlock({ code }: { code: string }) {
  // Constrain Ctrl/Cmd+A to the focused snippet rather than letting the
  // browser default expand the selection to the whole modal — v1.3.1 M5.
  function handleKeyDown(e: React.KeyboardEvent<HTMLPreElement>) {
    const isSelectAll = (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')
    if (!isSelectAll) return
    e.preventDefault()
    const range = document.createRange()
    range.selectNodeContents(e.currentTarget)
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  return (
    <pre
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="overflow-x-auto rounded-md p-2"
      style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        margin: 0,
        whiteSpace: 'pre',
        outline: 'none',
      }}
    >
      {code}
    </pre>
  )
}

function ApiTable({ rows }: { rows: ApiRow[] }) {
  const { t } = useTranslation()
  return (
    <table className="w-full" style={{ fontSize: 13, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th
            className="py-2 pr-4 text-left"
            style={{ fontWeight: 600, color: 'var(--muted)', width: '45%' }}
          >
            {t('scriptHelp.api.expression')}
          </th>
          <th className="py-2 text-left" style={{ fontWeight: 600, color: 'var(--muted)' }}>
            {t('scriptHelp.api.description')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.expr} style={{ borderBottom: '1px solid var(--border-split)' }}>
            <td
              className="py-1.5 pr-4"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text)',
                verticalAlign: 'top',
              }}
            >
              {r.expr}
            </td>
            <td className="py-1.5" style={{ color: 'var(--muted)', verticalAlign: 'top' }}>
              {t(r.descKey)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SnippetList({ snippets }: { snippets: Snippet[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      {snippets.map((s) => (
        <div key={s.titleKey}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            {t(s.titleKey)}
          </div>
          <CodeBlock code={s.code} />
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text)',
        marginBottom: 6,
        marginTop: 18,
      }}
    >
      {children}
    </div>
  )
}

export default function ScriptHelpModal({
  open,
  onClose,
  variant = 'post',
  isMcp = false,
}: ScriptHelpModalProps) {
  const { t } = useTranslation()
  // Pre-request scripts can't read response data — surface request-time
  // snippets first so the user lands on the right examples.
  const responseSnippets = variant === 'post' ? RESPONSE_SNIPPETS : PRE_SNIPPETS

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={t('scriptHelp.title')}
    >
      <div
        className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--white)]"
        style={{
          width: 680,
          maxWidth: '94vw',
          maxHeight: '86vh',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex flex-col">
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              {t('scriptHelp.title')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {variant === 'post' ? t('scriptHelp.subtitlePost') : t('scriptHelp.subtitlePre')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-[var(--hint)] hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('scriptHelp.intro')}</p>

          <SectionTitle>
            {variant === 'post'
              ? t('scriptHelp.section.responseChecks')
              : t('scriptHelp.section.preRequest')}
          </SectionTitle>
          <SnippetList snippets={responseSnippets} />

          <SectionTitle>{t('scriptHelp.section.variables')}</SectionTitle>
          <SnippetList snippets={ENV_SNIPPETS} />

          <SectionTitle>{t('scriptHelp.section.api')}</SectionTitle>
          <ApiTable rows={API_ROWS} />

          {variant === 'post' && isMcp && (
            <div data-testid="script-help-mcp">
              <SectionTitle>{t('scriptHelp.section.mcp')}</SectionTitle>
              <p className="mb-2 text-[13px] text-[var(--muted)]">{t('scriptHelp.mcp.intro')}</p>
              <SnippetList snippets={MCP_SNIPPETS} />
              <div className="mt-2">
                <ApiTable rows={MCP_API_ROWS} />
              </div>
            </div>
          )}

          <SectionTitle>{t('scriptHelp.section.notes')}</SectionTitle>
          <ul
            style={{
              fontSize: 13,
              color: 'var(--muted)',
              paddingLeft: 18,
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            <li>{t('scriptHelp.note.pm')}</li>
            <li>{t('scriptHelp.note.async')}</li>
            <li>{t('scriptHelp.note.scope')}</li>
            <li>{t('scriptHelp.note.console')}</li>
          </ul>
        </div>
      </div>
    </Modal>
  )
}
