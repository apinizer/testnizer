/**
 * Guard: no hard-coded English UI text in the renderer (tester finding 6).
 *
 * With the UI in Turkish, the header's Pull / Push, the branch menu's Merge /
 * New Branch, the "Pulling from remote…" overlay and the Duplicate toast all
 * stayed English: they were string literals, not `t()` calls. Nothing caught
 * it — a literal is not a type error and the e2e specs run in English.
 *
 * This test parses every renderer `.ts` / `.tsx` (TypeScript's own parser, no
 * regexes over JSX) and collects the strings that reach the screen:
 *   - JSX text nodes and string expressions used as JSX children,
 *   - `title` / `aria-label` / `placeholder` / `alt` / `label` attributes and
 *     the text props of our own components (`text`, `description`, `hint` …),
 *   - the first argument of the user-facing sinks: `toast.*`, `confirm`,
 *     `alert`, `setGitLoading`, `setStatusMsg`,
 *   - in `components/`, object-literal properties named `label` / `title` /
 *     `placeholder` / `description` / `tooltip` (option, tab and menu tables
 *     such as `const TABS = [{ key: 'body', label: 'Body' }]`). Store a key
 *     (`labelKey: 'request.body'`) and call `t()` where it renders — never
 *     `t()` at module scope, which freezes the import-time locale.
 * A string is followed through `?:`, `||`, `??`, `+` and the static parts of a
 * template literal (so `cond ? 'Pull' : 'Push'` and `` `Duplicated "${x}"` ``
 * are both seen). A call result (`t('…')`, `formatCount(…)`) is never text.
 *
 * A string is a violation when it has a natural-language word: anything that
 * is not code-like (`{{var}}`, URLs, paths, PEM, JSON, identifiers with
 * digits / `-` / `_` / `.`) and not in the explicit TECHNICAL vocabulary
 * below (brand, protocol, format, unit, standard names — words a Turkish UI
 * also writes as-is). The vocabulary is a word list, not a shape rule: an
 * all-caps label such as "URL PREVIEW" is still caught.
 *
 * Strings that were already there when the guard landed and are not yet
 * translated live in `KNOWN_UNTRANSLATED`, keyed `file|text` (never by line).
 * The list can only shrink: a new violation fails, and an entry that no longer
 * matches anything (it was translated or moved) fails too, so it is removed.
 *
 * Known limits (deliberate, not worth the false positives they would bring):
 *   - Object-literal labels are scanned in `components/` only. In `stores/`
 *     and `lib/` a key named `label` / `description` is as often a brand
 *     name, a value sent to main or tool reference text with its own TR twin
 *     (`lib/tools/http-status-tr.ts`); check such tables by eye. Seed-data
 *     files under `components/` are listed in SEED_DATA_FILES with why.
 *   - A word with an inner `-` or `'` counts as code (`sign-in`, `don't`).
 *   - Sinks match the callee text exactly, so `useUIStore.getState()
 *     .setGitLoading('…')` is not seen; call the store action directly.
 *   - Main-process messages are not scanned here: they reach the screen as a
 *     stable `errorCode` the renderer translates (see lib/git-error-text.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const RENDERER = resolve(__dirname, '../../src/renderer')
const SCANNED_DIRS = ['components', 'stores', 'lib']
const SKIPPED_FILES = new Set(['lib/i18n.ts'])

const WATCHED_ATTRS = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  // Text props of our own components (<Label text>, <EmptyState description> …)
  'text',
  'description',
  'hint',
  'heading',
  'subtitle',
  'tooltip',
])
/** Object-literal property names whose string value is UI text (in `components/`). */
const WATCHED_PROPS = new Set(['label', 'title', 'placeholder', 'description', 'tooltip'])
const OBJECT_LABEL_DIR = 'components/'

/**
 * Files under `components/` whose object literals are not UI text, with why.
 * The object-literal rule skips them; JSX / attribute / sink rules still apply.
 */
const SEED_DATA_FILES: Readonly<Record<string, string>> = {
  // Preset content written into a NEW mock server (server / endpoint
  // description), editable by the user and saved with the project like the
  // response bodies next to it — the same in every locale.
  'components/mock/mock-http-presets.ts': 'mock server seed content',
  'components/mock/mock-sse-presets.ts': 'mock server seed content',
  'components/mock/mock-ai-presets.ts': 'mock server seed content',
  // MCP tool / prompt / schema definitions the Mock MCP server sends to
  // clients and LLMs over the protocol (`title`, `description` are MCP
  // fields), plus the preset server descriptions saved with them.
  'components/mock-mcp/mock-mcp-presets.ts': 'MCP protocol payload seed',
}

const SINK_CALLS = new Set([
  'toast.success',
  'toast.error',
  'toast.warning',
  'toast.info',
  'toast.message',
  'window.confirm',
  'window.alert',
  'confirm',
  'alert',
  'setGitLoading',
  'setStatusMsg',
])

/**
 * Words a Turkish UI writes as-is. Keep it to names — product, protocol,
 * format, unit and standard identifiers. An ordinary English word ("Token",
 * "Value", "Preview") does NOT belong here; translate it.
 */
const TECHNICAL = new Set([
  // Product / brand names
  'Testnizer',
  'Apinizer',
  'Postman',
  'Insomnia',
  'Bruno',
  'Apidog',
  'GitHub',
  'GitLab',
  'Git',
  'Monaco',
  // Protocols, formats, languages
  'HTTP',
  'HTTPS',
  'REST',
  'SOAP',
  'WSDL',
  'gRPC',
  'GraphQL',
  'WebSocket',
  'MQTT',
  'SSE',
  'MCP',
  'JSON',
  'XML',
  'YAML',
  'HTML',
  'CSV',
  'URL',
  'URI',
  'JWT',
  'JWE',
  'JWS',
  'JWK',
  'JWKS',
  'OAuth',
  'TLS',
  'SSL',
  'PEM',
  'ASCII',
  'UTF',
  'cURL',
  'curl',
  'stdio',
  'JavaScript',
  'XPath',
  'JSONPath',
  'Streamable',
  'WSSE',
  // Standards, algorithms, spec element names
  'ISO',
  'GMT',
  'UTC',
  'RFC',
  'OTP',
  'QR',
  'UUID',
  'HMAC',
  'TTL',
  'ID',
  'PasswordText',
  'PasswordDigest',
  'UsernameToken',
  'SOAPAction',
  // Auth scheme names
  'Bearer',
  'Basic',
  // HTTP methods
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'QUERY',
  // Units and numeral-base abbreviations
  'ms',
  'KB',
  'MB',
  'px',
  'Hex',
  'Bin',
  'Dec',
  // Terms the Turkish UI already writes as-is (see the TR dictionary)
  'keystore',
  'Proto',
  'Nonce',
  // Wire-format field names shown next to their value (SSE `id:` / `retry:`,
  // JOSE `alg=` / `enc=` / `kid`, X.509 `CN=`, TLS `SNI`) and command names
  'id',
  'retry',
  'alg',
  'enc',
  'kid',
  'CN',
  'SNI',
  'npx',
  // Default git branch name
  'main',
  // MCP / LLM protocol enum values shown as options
  'user',
  'assistant',
])

/** JSX text inside these elements is code, not prose. */
const CODE_ELEMENTS = new Set(['code', 'pre', 'kbd', 'samp'])

/** Sentence punctuation stripped from a token's ends (joiners like - _ = / stay). */
const EDGE_PUNCT =
  /^[\s"'“”‘’()[\]{}<>,;:!?…·•→←›‹✓✗×—–*#.]+|[\s"'“”‘’()[\]{}<>,;:!?…·•→←›‹✓✗×—–*#.]+$/gu

/**
 * Pre-existing violations, keyed `file|text`. Grouped by why they are still
 * here. Shrink it: translate a string, then delete its line.
 */
const KNOWN_UNTRANSLATED: readonly string[] = [
  // The typed confirmation keyword: the confirm check compares the input
  // against the literal "delete" in every locale (see the comment there).
  'components/modals/DeleteConfirmDialog.tsx|delete',
  // Spec names shown as option labels / values, the same in every locale:
  // OAuth 2.0 grant types (RFC 6749), the gRPC status name, the WS-Security
  // <wsu:Created> element, an example SOAP operation name.
  'components/request/AuthTab.tsx|Authorization Code',
  'components/request/AuthTab.tsx|Client Credentials',
  'components/request/AuthTab.tsx|Password Credentials',
  'components/request/AuthTab.tsx|Implicit',
  'components/protocols/GrpcResponsePane.tsx|OK',
  // gRPC RPC kinds (spec names), deliberately untranslated like JSON / XML
  // (see shell-i18n-tr.test.tsx).
  'components/protocols/GrpcRequestPane.tsx|Unary',
  'components/protocols/GrpcRequestPane.tsx|Server Stream',
  'components/protocols/GrpcRequestPane.tsx|Client Stream',
  'components/protocols/GrpcRequestPane.tsx|Bidi Stream',
  'components/tools/WsSecurityTool.tsx|Created',
  'components/protocols/SoapManualForm.tsx|Echo',
  // `info.title` of the sample OpenAPI document the YAML ⇄ JSON tool loads:
  // document content the user converts, not a label.
  'components/tools/YamlJsonTool.tsx|Pet store',
]

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&middot;': '·',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&apos;': "'",
  '&quot;': '"',
  '&nbsp;': ' ',
  '&#10;': '\n',
}

function decode(s: string): string {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
}

/** Whole string is code / an example value, not prose. */
function isCodeLike(s: string): boolean {
  const t = s.trim()
  return (
    t.includes('{{') ||
    t.includes('://') ||
    t.includes('-----') ||
    /^[{[]/.test(t) ||
    /^(\/|\$\.|pm\.)/.test(t)
  )
}

/** The natural-language words in `s` (empty → nothing to translate). */
function naturalWords(raw: string): string[] {
  const s = decode(raw).replace(/\s+/g, ' ').trim()
  if (!s || isCodeLike(s)) return []
  const words: string[] = []
  for (const tok of s.split(' ')) {
    const w = tok.replace(EDGE_PUNCT, '')
    if (w.length < 2) continue
    // Identifier / value shape: digits or joiners inside the token.
    if (/[^\p{L}]/u.test(w)) continue
    if (TECHNICAL.has(w)) continue
    words.push(w)
  }
  return words
}

/** String literals an expression can evaluate to (through ?:, ||, ??, +). */
function literalTexts(e: ts.Expression): string[] {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text]
  if (ts.isTemplateExpression(e)) {
    return [[e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(' ')]
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return literalTexts(e.expression)
  if (ts.isConditionalExpression(e))
    return [...literalTexts(e.whenTrue), ...literalTexts(e.whenFalse)]
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind
    if (
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken ||
      k === ts.SyntaxKind.PlusToken
    ) {
      return [...literalTexts(e.left), ...literalTexts(e.right)]
    }
  }
  return []
}

function insideCodeElement(n: ts.Node): boolean {
  const el = n.parent
  return ts.isJsxElement(el) && CODE_ELEMENTS.has(el.openingElement.tagName.getText())
}

interface Hit {
  file: string
  line: number
  text: string
}

function scanFile(full: string): Hit[] {
  const file = relative(RENDERER, full).split('\\').join('/')
  const src = readFileSync(full, 'utf8')
  const kind = full.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(full, src, ts.ScriptTarget.Latest, true, kind)
  const hits: Hit[] = []
  const add = (node: ts.Node, text: string): void => {
    if (naturalWords(text).length === 0) return
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    hits.push({ file, line, text: decode(text).replace(/\s+/g, ' ').trim() })
  }
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n)) {
      if (!insideCodeElement(n)) add(n, n.text)
    } else if (
      ts.isJsxExpression(n) &&
      n.expression &&
      (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))
    ) {
      for (const s of literalTexts(n.expression)) add(n, s)
    } else if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText(sf)
      if (WATCHED_ATTRS.has(name)) {
        const init = n.initializer
        if (ts.isStringLiteral(init)) add(n, init.text)
        else if (ts.isJsxExpression(init) && init.expression) {
          for (const s of literalTexts(init.expression)) add(n, s)
        }
      }
    } else if (ts.isCallExpression(n) && n.arguments.length > 0) {
      if (SINK_CALLS.has(n.expression.getText(sf))) {
        for (const s of literalTexts(n.arguments[0])) add(n, s)
      }
    } else if (objectLabels && isWatchedProp(n)) {
      for (const s of literalTexts(n.initializer)) add(n, s)
    }
    ts.forEachChild(n, visit)
  }
  const objectLabels = file.startsWith(OBJECT_LABEL_DIR) && !(file in SEED_DATA_FILES)
  visit(sf)
  return hits
}

/** `{ label: '…' }` — a watched property assigned in an object literal. */
function isWatchedProp(n: ts.Node): n is ts.PropertyAssignment {
  return (
    ts.isPropertyAssignment(n) &&
    (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) &&
    WATCHED_PROPS.has(n.name.text)
  )
}

function scanRenderer(): Hit[] {
  const hits: Hit[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
        const rel = relative(RENDERER, full).split('\\').join('/')
        if (!SKIPPED_FILES.has(rel)) hits.push(...scanFile(full))
      }
    }
  }
  for (const d of SCANNED_DIRS) walk(join(RENDERER, d))
  return hits
}

const keyOf = (h: Hit): string => `${h.file}|${h.text}`

describe('i18n — no hard-coded UI text in the renderer', () => {
  const hits = scanRenderer()
  const known = new Set(KNOWN_UNTRANSLATED)

  it('every user-facing string goes through t()', () => {
    const fresh = hits
      .filter((h) => !known.has(keyOf(h)))
      .map((h) => `${h.file}:${h.line}  ${JSON.stringify(h.text)}`)
    expect(
      fresh,
      `Hard-coded UI text — add an i18n key (EN + TR) and call t():\n${fresh.join('\n')}`,
    ).toEqual([])
  })

  it('the known-untranslated list has no stale entries', () => {
    const seen = new Set(hits.map(keyOf))
    const stale = KNOWN_UNTRANSLATED.filter((k) => !seen.has(k))
    expect(
      stale,
      `Translated or moved — delete from KNOWN_UNTRANSLATED:\n${stale.join('\n')}`,
    ).toEqual([])
  })

  it('every seed-data exclusion is an existing file', () => {
    const missing = Object.keys(SEED_DATA_FILES).filter((f) => {
      try {
        return !statSync(join(RENDERER, f)).isFile()
      } catch {
        return true
      }
    })
    expect(missing, `Moved or deleted — update SEED_DATA_FILES:\n${missing.join('\n')}`).toEqual([])
  })

  it('catches the shapes that slipped through in finding 6', () => {
    const probe = (code: string): string[] => {
      const sf = ts.createSourceFile('p.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const out: string[] = []
      const visit = (n: ts.Node): void => {
        if (ts.isJsxText(n)) out.push(...naturalWords(n.text))
        else if (ts.isJsxExpression(n) && n.expression && ts.isJsxElement(n.parent)) {
          for (const s of literalTexts(n.expression)) out.push(...naturalWords(s))
        } else if (ts.isCallExpression(n) && SINK_CALLS.has(n.expression.getText(sf))) {
          for (const s of literalTexts(n.arguments[0])) out.push(...naturalWords(s))
        } else if (isWatchedProp(n)) {
          for (const s of literalTexts(n.initializer)) out.push(...naturalWords(s))
        }
        ts.forEachChild(n, visit)
      }
      visit(sf)
      return out
    }
    expect(probe(`const a = <span>{kind === 'pull' ? 'Pull' : 'Push'}</span>`)).toEqual([
      'Pull',
      'Push',
    ])
    expect(probe('toast.success(`Duplicated "${name}"`)')).toEqual(['Duplicated'])
    expect(probe(`setGitLoading('Pulling from remote...')`)).toEqual(['Pulling', 'from', 'remote'])
    expect(probe(`const a = <div>URL PREVIEW</div>`)).toEqual(['PREVIEW'])
    // Option / tab tables: the label is UI text, the key and value are not.
    expect(probe(`const TABS = [{ key: 'body', label: 'Body', value: 'raw text' }]`)).toEqual([
      'Body',
    ])
    expect(
      probe(`const O = [{ id: 'TLSv1.2', label: 'TLS 1.2', title: x ? 'Old' : 'New' }]`),
    ).toEqual(['Old', 'New'])
    expect(probe(`const TABS = [{ key: 'body', labelKey: 'request.body' }]`)).toEqual([])
    // Not text: translated calls, code-like values, technical names, units.
    expect(probe(`const a = <span>{t('x.y')} · 142 ms · JSON</span>`)).toEqual([])
    expect(probe(`const a = <span>{'{{baseUrl}}/users'}</span>`)).toEqual([])
  })
})
