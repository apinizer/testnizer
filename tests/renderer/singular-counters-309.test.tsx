/**
 * Issue #309 — counters with no singular form ("1 entries" class).
 *
 * CONTRACT: each counter is one `{count}` string pair `<key>One` / `<key>`
 * (the convention the G-14 fix started with `mock.entryCountOne` /
 * `mock.entryCount`), picked by ONE helper, `formatCount` in
 * `src/renderer/lib/plural.ts`: `formatCount(n, t('…One'), t('…'))`.
 * EN says "1 warning" / "2 warnings"; Turkish has no plural after a number,
 * so its two strings may be identical ("1 uyarı" / "2 uyarı").
 */
import * as React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import HttpStatusTool from '../../src/renderer/components/tools/HttpStatusTool'
import { t, valuesInAllLocales } from '../../src/renderer/lib/i18n'
import { useLocale } from './helpers/default-locale-shim'

afterEach(() => {
  cleanup()
  useLocale('en')
})

/** [counter, one key, other key, EN for 1, EN for 2, TR for 1, TR for 2] */
const COUNTERS: Array<[string, string, string, string, string, string, string]> = [
  [
    'HTTP status codes',
    'tools.httpStatus.codeCountOne',
    'tools.httpStatus.codeCount',
    '1 code',
    '2 codes',
    '1 kod',
    '2 kod',
  ],
  [
    'JSONPath / XPath matches',
    'tools.jsonpath.matchCountOne',
    'tools.jsonpath.matchCount',
    '1 match',
    '2 matches',
    '1 eşleşme',
    '2 eşleşme',
  ],
  [
    'UUID generated',
    'tools.uuid.generatedCountOne',
    'tools.uuid.generatedCount',
    '1 UUID generated — click to copy',
    '2 UUIDs generated — click any to copy',
    '1 UUID üretildi — kopyalamak için tıklayın',
    '2 UUID üretildi — kopyalamak için tıklayın',
  ],
  [
    'Diff lines',
    'tools.diff.lineCountOne',
    'tools.diff.lineCount',
    '1 line',
    '2 lines',
    '1 satır',
    '2 satır',
  ],
  [
    'Diff removals',
    'tools.diff.removalCountOne',
    'tools.diff.removalCount',
    '1 removal',
    '2 removals',
    '1 silinen',
    '2 silinen',
  ],
  [
    'Diff additions',
    'tools.diff.additionCountOne',
    'tools.diff.additionCount',
    '1 addition',
    '2 additions',
    '1 eklenen',
    '2 eklenen',
  ],
  [
    'Password generator',
    'tools.passwordGen.generatedCountOne',
    'tools.passwordGen.generatedCount',
    '1 password generated — click to copy',
    '2 passwords generated — click any to copy',
    '1 parola üretildi — kopyalamak için tıklayın',
    '2 parola üretildi — kopyalamak için tıklayın',
  ],
  [
    'Keystore aliases',
    'tools.keystore.aliasCountOne',
    'tools.keystore.aliasCount',
    '1 alias',
    '2 aliases',
    '1 alias',
    '2 alias',
  ],
  [
    'Merge-conflict files',
    'mergeConflict.fileCountOne',
    'mergeConflict.fileCount',
    '1 file',
    '2 files',
    '1 dosya',
    '2 dosya',
  ],
  [
    'AI Chat model calls',
    'aiChat.metrics.callCountOne',
    'aiChat.metrics.callCount',
    '1 model call',
    '2 model calls',
    '1 model çağrısı',
    '2 model çağrısı',
  ],
  [
    'Mock import warnings',
    'mock.warningCountOne',
    'mock.warningCount',
    '1 warning',
    '2 warnings',
    '1 uyarı',
    '2 uyarı',
  ],
  [
    'Mock import endpoints',
    'mock.importEndpointCountOne',
    'mock.importEndpointCount',
    '1 endpoint',
    '2 endpoints',
    '1 uç nokta',
    '2 uç nokta',
  ],
  [
    'Mock import responses',
    'mock.importResponseCountOne',
    'mock.importResponseCount',
    '1 response',
    '2 responses',
    '1 yanıt',
    '2 yanıt',
  ],
  [
    'MCP security warnings',
    'mcp.security.summary.warnCountOne',
    'mcp.security.summary.warnCount',
    '1 warning',
    '2 warnings',
    '1 uyarı',
    '2 uyarı',
  ],
  [
    'Tool byte counts',
    'tools.common.byteCountOne',
    'tools.common.byteCount',
    '1 byte',
    '2 bytes',
    '1 bayt',
    '2 bayt',
  ],
  [
    'Regex matches',
    'tools.regex.matchCountOne',
    'tools.regex.matchCount',
    '1 match',
    '2 matches',
    '1 eşleşme',
    '2 eşleşme',
  ],
  [
    'Run history selection',
    'runnerHistory.selectedCountOne',
    'runnerHistory.selectedCount',
    '1 item selected',
    '2 items selected',
    '1 öğe seçildi',
    '2 öğe seçildi',
  ],
  [
    'Run history delete',
    'deleteConfirm.runCountOne',
    'deleteConfirm.runCount',
    '1 run',
    '2 runs',
    '1 çalıştırma kaydı',
    '2 çalıştırma kaydı',
  ],
  [
    'Environment variables',
    'env.variableCountOne',
    'env.variableCount',
    '1 variable',
    '2 variables',
    '1 değişken',
    '2 değişken',
  ],
  [
    'SSE / GraphQL / gRPC events',
    'sse.eventCountOne',
    'sse.eventCount',
    '1 event',
    '2 events',
    '1 olay',
    '2 olay',
  ],
  [
    'Mock log entries',
    'mock.entryCountOne',
    'mock.entryCount',
    '1 entry',
    '2 entries',
    '1 kayıt',
    '2 kayıt',
  ],
  [
    'Keystore convert skipped',
    'tools.keystore.toast.convertSkippedOne',
    'tools.keystore.toast.convertSkipped',
    '1 entry could not be carried over and was left out: {aliases}',
    '2 entries could not be carried over and were left out: {aliases}',
    '1 girdi taşınamadı ve dışarıda bırakıldı: {aliases}',
    '2 girdi taşınamadı ve dışarıda bırakıldı: {aliases}',
  ],
  [
    'TLS expires in',
    'tools.tlsInspect.inDaysOne',
    'tools.tlsInspect.inDays',
    'in 1 day',
    'in 2 days',
    '1 gün içinde',
    '2 gün içinde',
  ],
  [
    'TLS expired ago',
    'tools.tlsInspect.expiredAgoOne',
    'tools.tlsInspect.expiredAgo',
    '1 day ago',
    '2 days ago',
    '1 gün önce',
    '2 gün önce',
  ],
  [
    'Keystore alias expires in',
    'tools.keystore.inDaysOne',
    'tools.keystore.inDays',
    'in 1 day',
    'in 2 days',
    '1 gün içinde',
    '2 gün içinde',
  ],
  [
    'Keystore alias expired ago',
    'tools.keystore.daysAgoOne',
    'tools.keystore.daysAgo',
    '1 day ago',
    '2 days ago',
    '1 gün önce',
    '2 gün önce',
  ],
  [
    'AI Chat tokens',
    'aiChat.metrics.tokenCountOne',
    'aiChat.metrics.tokenCount',
    '1 token',
    '2 tokens',
    '1 token',
    '2 token',
  ],
  [
    'About licenses',
    'about.licensesCountOne',
    'about.licensesCount',
    '1 package',
    '2 packages',
    '1 paket',
    '2 paket',
  ],
  [
    'Tests home runs',
    'testsHome.runCountOne',
    'testsHome.runCount',
    '1 run',
    '2 runs',
    '1 çalıştırma',
    '2 çalıştırma',
  ],
  [
    'Runner iterations',
    'runnerConfig.iterationCountOne',
    'runnerConfig.iterationCountOther',
    '1 iteration',
    '2 iterations',
    '1 yineleme',
    '2 yineleme',
  ],
  [
    'Run result requests',
    'runResults.requestsOne',
    'runResults.requestsOther',
    '1 request',
    '2 requests',
    '1 istek',
    '2 istek',
  ],
  [
    'Socket.IO arguments',
    'socketio.argsOne',
    'socketio.argsOther',
    '1 argument',
    '2 arguments',
    '1 argüman',
    '2 argüman',
  ],
  [
    'Discard changes button',
    'gitCommit.discardConfirmOne',
    'gitCommit.discardConfirm',
    'Discard 1 change',
    'Discard 2 changes',
    '1 değişikliği at',
    '2 değişikliği at',
  ],
]

/** The strings a renderer counter shows: `{count}` replaced, one/other by n. */
function shown(oneKey: string, otherKey: string, n: number): string {
  return (n === 1 ? t(oneKey) : t(otherKey)).replace('{count}', String(n))
}

describe('every counter has a singular form (issue #309)', () => {
  it.each(COUNTERS)('%s: keys exist exactly once per locale', (_n, one, other) => {
    expect(valuesInAllLocales(one), one).toHaveLength(2)
    expect(valuesInAllLocales(other), other).toHaveLength(2)
    for (const v of valuesInAllLocales(other)) expect(v, other).toContain('{count}')
  })

  it.each(COUNTERS)('%s: EN "1 X" / "2 Xs"', (_n, one, other, en1, en2) => {
    useLocale('en')
    expect(shown(one, other, 1)).toBe(en1)
    expect(shown(one, other, 2)).toBe(en2)
  })

  it.each(COUNTERS)('%s: TR has no plural after a number', (_n, one, other, _e1, _e2, tr1, tr2) => {
    useLocale('tr')
    expect(shown(one, other, 1)).toBe(tr1)
    expect(shown(one, other, 2)).toBe(tr2)
  })

  it('mock.importDone composes the three counters (no plural word of its own)', () => {
    for (const v of valuesInAllLocales('mock.importDone')) {
      expect(v).toContain('{endpoints}')
      expect(v).toContain('{responses}')
      expect(v).toContain('{warnings}')
      // The nouns come from the counters, not from a fixed plural after the placeholder.
      expect(v).not.toMatch(/\{endpoints\} (endpoints|uç nokta)|\{responses\} (responses|yanıt)/)
    }
  })
})

describe('the one helper (src/renderer/lib/plural.ts)', () => {
  it('formatCount picks the singular for exactly 1 and fills {count}', async () => {
    // Variable specifier: a missing module fails THIS test, not the whole file.
    const modPath = '../../src/renderer/lib/plural'
    const { formatCount } = (await import(/* @vite-ignore */ modPath)) as {
      formatCount: (n: number, one: string, other: string) => string
    }
    expect(formatCount(1, '1 code', '{count} codes')).toBe('1 code')
    expect(formatCount(0, '1 code', '{count} codes')).toBe('0 codes')
    expect(formatCount(2, '1 code', '{count} codes')).toBe('2 codes')
    expect(formatCount(1, '{count} kod', '{count} kod')).toBe('1 kod')
  })
})

/** Every call site, with the [one, other] key pairs it must render through `formatCount`. */
const SITES: Array<[string, Array<[string, string]>]> = [
  ['components/tools/HttpStatusTool.tsx', [pair('tools.httpStatus.codeCount')]],
  ['components/tools/JsonPathTool.tsx', [pair('tools.jsonpath.matchCount')]],
  ['components/tools/XPathTool.tsx', [pair('tools.jsonpath.matchCount')]],
  ['components/tools/RegexTool.tsx', [pair('tools.regex.matchCount')]],
  ['components/tools/UuidTool.tsx', [pair('tools.uuid.generatedCount')]],
  [
    'components/tools/DiffTool.tsx',
    [
      pair('tools.diff.lineCount'),
      pair('tools.diff.removalCount'),
      pair('tools.diff.additionCount'),
    ],
  ],
  ['components/tools/password/OutputList.tsx', [pair('tools.passwordGen.generatedCount')]],
  [
    'components/tools/KeystoreTool.tsx',
    [pair('tools.keystore.aliasCount'), pair('tools.keystore.toast.convertSkipped')],
  ],
  [
    'components/tools/keystore/AliasTable.tsx',
    [pair('tools.keystore.inDays'), pair('tools.keystore.daysAgo')],
  ],
  [
    'components/tools/tls/ResultPane.tsx',
    [pair('tools.tlsInspect.inDays'), pair('tools.tlsInspect.expiredAgo')],
  ],
  ['components/tools/JsonFormatTool.tsx', [pair('tools.common.byteCount')]],
  ['components/tools/HashTool.tsx', [pair('tools.common.byteCount')]],
  ['components/modals/MergeConflictModal.tsx', [pair('mergeConflict.fileCount')]],
  ['components/modals/EnvironmentModal.tsx', [pair('env.variableCount')]],
  ['components/modals/AboutModal.tsx', [pair('about.licensesCount')]],
  [
    'components/modals/DiscardChangesDialog.tsx',
    [pair('gitCommit.discardBody'), pair('gitCommit.discardConfirm')],
  ],
  [
    'components/protocols/ai-chat/AiChatMetricsRow.tsx',
    [pair('aiChat.metrics.callCount'), pair('aiChat.metrics.tokenCount')],
  ],
  ['components/protocols/mcp/McpSecurityCategory.tsx', [pair('mcp.security.summary.warnCount')]],
  ['components/protocols/mcp/McpSecuritySummary.tsx', [pair('mcp.security.summary.warnCount')]],
  ['components/protocols/SseEventLog.tsx', [pair('sse.eventCount')]],
  ['components/protocols/GraphQLSubscriptionLog.tsx', [pair('sse.eventCount')]],
  ['components/protocols/GrpcResponsePane.tsx', [pair('sse.eventCount')]],
  ['components/protocols/WsMessageLog.tsx', [['ws.countsOne', 'ws.countsOther']]],
  ['components/protocols/mqtt/MqttLog.tsx', [['ws.countsOne', 'ws.countsOther']]],
  ['components/protocols/socketio/SioComposer.tsx', [['socketio.argsOne', 'socketio.argsOther']]],
  [
    'components/runner/RunnerHistory.tsx',
    [pair('deleteConfirm.runCount'), pair('runnerHistory.selectedCount')],
  ],
  [
    'components/runner/RunnerConfig.tsx',
    [['runnerConfig.iterationCountOne', 'runnerConfig.iterationCountOther']],
  ],
  ['components/runner/RunnerResults.tsx', [['runResults.requestsOne', 'runResults.requestsOther']]],
  ['components/runner/TestsHome.tsx', [pair('testsHome.runCount')]],
  ['components/mock/mock-kind-ui.ts', [pair('mock.serverTypeConfirmBody')]],
  ['components/modals/PushCommitModal.tsx', [pair('push.includePending')]],
  ['lib/pull-messages.ts', [['toast.pulledEmptySecretOne', 'toast.pulledEmptySecrets']]],
  [
    'components/mock/MockServerEditor.tsx',
    [
      pair('mock.warningCount'),
      pair('mock.importEndpointCount'),
      pair('mock.importResponseCount'),
      pair('mock.entryCount'),
    ],
  ],
]

function pair(key: string): [string, string] {
  return [`${key}One`, key]
}

const esc = (k: string): string => k.replace(/\./g, '\\.')

/** Keys that only ever followed a number as a bare plural word — gone now. */
const OLD_KEYS = [
  'tools.httpStatus.codes',
  'tools.jsonpath.matches',
  'tools.regex.matches',
  'tools.uuid.generated',
  'tools.diff.lines',
  'tools.diff.removalsLabel',
  'tools.diff.additionsLabel',
  'tools.passwordGen.generated',
  'tools.common.bytes',
  'tools.keystore.daysAgoSuffix',
  'tools.keystore.inPrefix',
  'tools.keystore.daysSuffix',
  'mergeConflict.files',
  'aiChat.metrics.calls',
  'mcp.security.summary.warn',
  'mock.warnings',
  'testsHome.run',
  'testsHome.runs',
]

describe('call sites go through formatCount (no "{n} {t(word)}")', () => {
  it.each(SITES)('%s', (file, pairs) => {
    const src = readFileSync(resolve(__dirname, '../../src/renderer', file), 'utf8')
    expect(src).toMatch(/import \{ formatCount \} from '(?:(?:\.\.\/)+lib\/|\.\/)plural'/)
    for (const [one, other] of pairs) {
      const call = new RegExp(
        `formatCount\\(\\s*[^,]+,\\s*t\\('${esc(one)}'\\),\\s*t\\('${esc(other)}'\\),?\\s*\\)`,
      )
      expect(src, `${file} renders ${other} with formatCount`).toMatch(call)
    }
    for (const old of OLD_KEYS) {
      expect(src, `${file} still uses ${old}`).not.toContain(`t('${old}')`)
    }
    expect(src).not.toMatch(/\{[\w.]+\} \{t\('tools\.keystore\.aliasCount'\)\}/)
  })

  it('no inline "=== 1 ? …One" plural ternary is left anywhere in the renderer', () => {
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry)) continue
        const src = readFileSync(full, 'utf8')
        for (const m of src.matchAll(/===\s*1\s*\?\s*(?:t\()?'[\w.]+One'/g)) {
          hits.push(`${full}: ${m[0]}`)
        }
      }
    }
    walk(resolve(__dirname, '../../src/renderer'))
    expect(hits).toEqual([])
  })
})

describe('rendered: HTTP status codes footer', () => {
  it('one hit → "1 code"; EN and TR', () => {
    render(<HttpStatusTool />)
    fireEvent.change(screen.getByPlaceholderText(t('tools.httpStatus.search')), {
      target: { value: '418' },
    })
    expect(screen.getByText('1 code')).toBeTruthy()
    cleanup()
    useLocale('tr')
    render(<HttpStatusTool />)
    fireEvent.change(screen.getByPlaceholderText(t('tools.httpStatus.search')), {
      target: { value: '418' },
    })
    expect(screen.getByText('1 kod')).toBeTruthy()
  })
})
