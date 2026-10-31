/**
 * issue #248 follow-up — the Runner configuration, Run Sequence and Run results
 * screens in Turkish.
 *
 * The product review (1.6.0) found these three screens mostly English in the
 * Turkish UI: headings, schedule controls, checkboxes, the Start button, the
 * results header ("Ran today at 12:31:17 AM"), stat labels, filter tabs, the
 * iteration header ("Iteration 1 (5 requests, 1 failed)"), status chips
 * ("NOT RUN"), the detail pane and the Run Sequence toolbar. Each case renders a
 * screen in TR, scans visible text plus title / aria-label / placeholder for
 * English, and pins key Turkish labels. The last block keeps the English UI
 * byte-identical for the e2e specs that match on it.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import type { EndpointRunResult, RunnerReport } from '../../src/shared/runner-types'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerConfig from '../../src/renderer/components/runner/RunnerConfig'
import RunnerResults from '../../src/renderer/components/runner/RunnerResults'
import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import type {
  RunnerEndpointItem,
  RunnerFolderGroup,
} from '../../src/renderer/components/runner/RunnerTab'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
;(globalThis as unknown as { React: typeof React }).React = React

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

const noop = (): void => {}

/** English that must not survive in TR (whole words, case-sensitive). */
const ENGLISH: RegExp[] = [
  // Config
  /\bChoose how\b/,
  /\bRun manually\b/,
  /\bSchedule (runs|run|Configuration)\b/,
  /\bInterval\b/,
  /\bDaily\b/,
  /\bWeekly\b/,
  /\bRun every\b/,
  /\bEvery day\b/,
  /\blocal time\b/,
  /\bfields\b/,
  /\bSupports\b/,
  /\blists\b/,
  /\bRun configuration\b/,
  /\bIterations?\b/,
  /\bDelay between\b/,
  /\bApplied after\b/,
  /\bExtra pause\b/,
  /\bBetween iterations\b/,
  /\bcompatible\b/,
  /\boverrides\b/,
  /\bSelect Data File\b/,
  /\bProvide a JSON\b/,
  /\bAdvanced Settings\b/,
  /\bPersist responses\b/,
  /\bStop run\b/,
  /\bKeep variable\b/,
  /\bStart run\b/,
  /\bRun lifecycle\b/,
  /\bminutes\b/,
  /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/,
  /\bm h dom\b/,
  // Results
  /\bRun results\b/,
  /\bRun Again\b/,
  /\bNew Run\b/,
  /\bRan today\b/,
  /\bView all runs\b/,
  /\bSource\b/,
  /\bEnvironment\b/,
  /\bActive\b/,
  /\bDuration\b/,
  /\bAll tests\b/,
  /\bAll requests\b/,
  /\bErrors\b/,
  /\bAvg\b/,
  /\bAll\b/,
  /\bPassed\b/,
  /\bFailed\b/,
  /\bSkipped\b/,
  /\bConsole( log)?\b/,
  /\bList\b/,
  /\bGrid\b/,
  /\brequests?\b/,
  /\bfailed\b/,
  /\bpassed\b/,
  /\bOpen endpoint\b/,
  /\bResponse\b/,
  /\bRequest\b/,
  /\bHeaders\b/,
  /\bTests\b/,
  /\bBody\b/,
  /\bPretty\b/,
  /\bMethod\b/,
  /\bNo (response|request) body\b/,
  /\bNo tests found\b/,
  /\bKey\b/,
  /\bValue\b/,
  /\bNOT RUN\b/,
  /\bSCRIPT\b/,
  /\bSKIPPED\b/,
  /\bRunner\b/,
  /\bRunning\b/,
  /\bCleaning up\b/,
  /\bStop(ping| now)?\b/,
  /\bHalt\b/,
  /\bEnd the run\b/,
  /\bTeardown\b/,
  /\bSetup\b/,
  // Run Sequence
  /\bRun Sequence\b/,
  /\bDeselect All\b/,
  /\bSelect( All| folder)?\b/,
  /\bReset\b/,
  /\bNo endpoints\b/,
  /\bExpand\b/,
  /\bCollapse\b/,
  /\bPhase\b/,
  /\bFlow\b/,
]

function englishLeftovers(): string[] {
  const parts: string[] = [document.body.textContent ?? '']
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr)
      if (v) parts.push(v)
    }
  }
  const text = parts.join('\n')
  return ENGLISH.filter((re) => re.test(text)).map((re) => {
    const line = text.split('\n').find((l) => re.test(l)) ?? ''
    return `${re} → "${line.trim().slice(0, 100)}"`
  })
}

/* ── RunnerConfig ─────────────────────────────────────────────────────────── */

function renderConfig(): void {
  render(
    <RunnerConfig
      delay={100}
      setDelay={noop}
      iterationDelay={50}
      setIterationDelay={noop}
      iterations={2}
      setIterations={noop}
      environmentId=""
      setEnvironmentId={noop}
      stopOnError={false}
      setStopOnError={noop}
      persistResponses={false}
      setPersistResponses={noop}
      keepVariableValues={false}
      setKeepVariableValues={noop}
      iterationData={[]}
      setIterationData={noop}
      runPreScript=""
      setRunPreScript={noop}
      runPostScript=""
      setRunPostScript={noop}
      onRun={noop}
      onSchedule={noop}
      isRunning={false}
      selectedCount={2}
      canSchedule
      onSaveConfig={async () => true}
    />,
  )
}

/* ── RunnerResults ────────────────────────────────────────────────────────── */

function result(over: Partial<EndpointRunResult> & { endpointId: string }): EndpointRunResult {
  return {
    endpointName: over.endpointId,
    method: 'GET',
    url: 'https://ornek.test/' + over.endpointId,
    status: 200,
    statusText: 'OK',
    duration: 12,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
    ...over,
  }
}

const RESULTS: EndpointRunResult[] = [
  result({ endpointId: 'hazirlik', endpointName: 'Oturum aç', phase: 'setup' }),
  result({
    endpointId: 'liste',
    endpointName: 'Kullanıcıları listele',
    iteration: 1,
    assertions: [{ name: 'durum 200', passed: true }],
    passed: 1,
    responseHeaders: { 'content-type': 'application/json' },
    requestHeaders: { accept: 'application/json' },
    responseBody: '{"ad":"Ali"}',
    requestBody: '{"sayfa":1}',
    responseSize: 12,
    consoleLogs: [{ level: 'log', message: 'merhaba', timestamp: 1 }],
  }),
  result({
    endpointId: 'olustur',
    endpointName: 'Kullanıcı oluştur',
    method: 'POST',
    iteration: 1,
    status: 500,
    statusText: 'Internal Server Error',
    assertions: [{ name: 'durum 201', passed: false }],
    failed: 1,
  }),
  result({
    endpointId: 'atlanan',
    endpointName: 'Hiç çalışmayan',
    iteration: 1,
    status: null,
    statusText: 'NOT_RUN',
  }),
  result({
    endpointId: 'betik',
    endpointName: 'Hazırlık betiği',
    status: null,
    statusText: 'SCRIPT',
    phase: 'teardown',
  }),
]

const REPORT: RunnerReport = {
  projectId: 'p1',
  startedAt: Date.now(),
  completedAt: Date.now() + 1500,
  totalEndpoints: 3,
  passedEndpoints: 1,
  failedEndpoints: 1,
  totalAssertions: 2,
  passedAssertions: 1,
  failedAssertions: 1,
  results: RESULTS,
}

function renderResults(
  over: Partial<React.ComponentProps<typeof RunnerResults>> = {},
): ReturnType<typeof render> {
  return render(
    <RunnerResults
      results={RESULTS}
      report={REPORT}
      isRunning={false}
      currentIndex={2}
      totalCount={5}
      runStartedAt={REPORT.startedAt}
      sourceLabel="Suite: Gece Kontrolü"
      onStop={noop}
      onStopDirect={noop}
      onNewRun={noop}
      onRunAgain={noop}
      onViewAllRuns={noop}
      selectedResultId="liste"
      onSelectResult={noop}
      onOpenEndpoint={noop}
      {...over}
    />,
  )
}

/* ── RunnerSequence ───────────────────────────────────────────────────────── */

function renderSequence(): void {
  const login: RunnerEndpointItem = {
    id: 'login',
    name: 'Giriş',
    method: 'POST',
    url: '/giris',
    selected: true,
  }
  const loose: RunnerEndpointItem = {
    id: 'saglik',
    name: 'Sağlık',
    method: 'GET',
    url: '/saglik',
    selected: false,
  }
  const groups: RunnerFolderGroup[] = [
    {
      folderId: 'kimlik',
      folderName: 'Kimlik',
      label: 'Kimlik',
      parentId: null,
      endpoints: [login],
    },
  ]
  render(
    <RunnerSequence
      endpoints={[login, loose]}
      folderGroups={groups}
      onToggle={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onReset={noop}
      onSetPhase={noop}
      onSetFolderPhase={noop}
      onToggleFolder={noop}
    />,
  )
}

beforeEach(() => {
  useLocale('tr')
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('issue #248 follow-up — Runner configuration in Turkish', () => {
  it('manual mode: headings, delays, iteration data, advanced settings and Start are Turkish', () => {
    renderConfig()
    expect(englishLeftovers()).toEqual([])
    expect(screen.getByText('Koleksiyonunuzu nasıl çalıştıracağınızı seçin')).toBeTruthy()
    expect(screen.getByText('Çalıştırma yapılandırması')).toBeTruthy()
    expect(screen.getByText('İstekler arası bekleme')).toBeTruthy()
    expect(
      screen.getByText('Yinelemeler arasında çalıştırıcı 150 ms bekler (100 + 50).'),
    ).toBeTruthy()
    expect(screen.getByText('Gelişmiş Ayarlar')).toBeTruthy()
    expect(screen.getByLabelText('Hata olursa çalıştırmayı durdur')).toBeTruthy()
    expect(screen.getByTestId('runner-start').textContent).toBe('Çalıştırmayı başlat')
    // Uppercase-free, but the root still carries the language for hyphenation
    // and screen readers.
    expect(screen.getByTestId('runner-start').closest('[lang]')?.getAttribute('lang')).toBe('tr')
  })

  it('schedule mode: every schedule type is Turkish', () => {
    renderConfig()
    act(() => {
      fireEvent.click(screen.getByLabelText('Çalıştırmaları planla'))
    })
    expect(screen.getByText('Plan Yapılandırması')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'dakikada bir' })).toBeTruthy()
    expect(englishLeftovers()).toEqual([])
    for (const type of ['Günlük', 'Haftalık', 'Cron']) {
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: type }))
      })
      expect(englishLeftovers()).toEqual([])
    }
    // Weekly shows the same day names as Scheduled Tasks.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Haftalık' }))
    })
    expect(screen.getByRole('button', { name: 'Pzt' })).toBeTruthy()
    expect(screen.getByTestId('runner-start').textContent).toBe('Çalıştırmayı planla')
  })
})

describe('issue #248 follow-up — Run results in Turkish', () => {
  it('header, stats, tabs, iteration header, status chips and the detail pane are Turkish', () => {
    renderResults()
    expect(englishLeftovers()).toEqual([])

    expect(screen.getByTestId('runner-results-title').textContent).toBe('Çalıştırma sonuçları')
    // 24-hour Turkish time, no AM/PM (was "Ran today at 12:31:17 AM").
    expect(screen.getByText(/^Çalıştırıldı: bugün, \d{2}:\d{2}:\d{2}$/)).toBeTruthy()
    expect(screen.getByText('Kaynak')).toBeTruthy()
    expect(screen.getByText('Test Paketi: Gece Kontrolü')).toBeTruthy()
    expect(screen.getByText('Ort. Yanıt Süresi')).toBeTruthy()
    expect(screen.getByTestId('runner-filter-console').textContent).toBe('Konsol kaydı 1')
    expect(screen.getByText('Yineleme 1')).toBeTruthy()
    expect(screen.getByText('(3 istek, 1 başarısız)')).toBeTruthy()
    const list = within(screen.getByTestId('runner-results-list'))
    expect(list.getByText('ÇALIŞMADI')).toBeTruthy()
    expect(list.getByText('BETİK')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Yanıt' })).toBeTruthy()
    expect(screen.getByText('Yanıt Başlıkları')).toBeTruthy()

    // Request + console detail tabs.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'İstek' }))
    })
    expect(screen.getByText('İstek Başlıkları')).toBeTruthy()
    expect(englishLeftovers()).toEqual([])
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Konsol' }))
    })
    expect(englishLeftovers()).toEqual([])
  })

  it('a run with one request says "1 istek"; the empty body state is Turkish', () => {
    renderResults({
      results: [result({ endpointId: 'tek', endpointName: 'Tek istek', iteration: 1 })],
      selectedResultId: 'tek',
    })
    expect(screen.getByText('(1 istek, 1 başarılı)')).toBeTruthy()
    expect(screen.getByText('Yanıt gövdesi yok.')).toBeTruthy()
    expect(screen.getByText('Test bulunamadı')).toBeTruthy()
    expect(englishLeftovers()).toEqual([])
  })

  it('the running state (progress line, both stop buttons) is Turkish', () => {
    renderResults({ isRunning: true, selectedResultId: null })
    expect(screen.getByText('Çalışıyor: 2 / 5...')).toBeTruthy()
    expect(screen.getByTestId('runner-stop').textContent).toBe('Durdur')
    expect(screen.getByTestId('runner-stop-direct').textContent).toBe('Hemen durdur')
    expect(englishLeftovers()).toEqual([])
  })
})

describe('issue #248 follow-up — "Ran today at" only for today', () => {
  // 15 Oct 2026, 09:30 local — never "today" for this suite's clock.
  const PAST = new Date(2026, 9, 15, 9, 30, 0).getTime()

  it('EN: a run from an earlier day names the date, not "today"', () => {
    useLocale('en')
    renderResults({ runStartedAt: PAST })
    expect(screen.queryByText(/Ran today/)).toBeNull()
    expect(screen.getByText(/^Ran on .*2026.* at .+$/)).toBeTruthy()
  })

  it('TR: a run from an earlier day names the Turkish date', () => {
    renderResults({ runStartedAt: PAST })
    expect(screen.queryByText(/bugün/)).toBeNull()
    expect(screen.getByText(/^Çalıştırıldı: 15 Eki 2026, 09:30:00$/)).toBeTruthy()
  })

  it('EN: a run from today keeps the exact "Ran today at" template', () => {
    useLocale('en')
    renderResults({ runStartedAt: Date.now() })
    expect(screen.getByText(/^Ran today at /)).toBeTruthy()
  })

  it('EN: the stop-on-error banner quotes the checkbox label', () => {
    useLocale('en')
    renderResults({ report: { ...REPORT, stopReason: 'stopOnError' } })
    expect(
      screen.getByText('Stopped early: a request failed and "Stop run if an error occurs" is on.'),
    ).toBeTruthy()
  })
})

describe('issue #248 follow-up — Run Sequence in Turkish', () => {
  it('toolbar, folder and request controls are Turkish', () => {
    renderSequence()
    expect(englishLeftovers()).toEqual([])
    expect(screen.getByText('Çalıştırma Sırası')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tümünü Bırak' })).toBeTruthy()
    expect(screen.getByLabelText('Kimlik klasörünü seç')).toBeTruthy()
    expect(screen.getByLabelText('Giriş isteğini seç')).toBeTruthy()
    // The phase pickers keep their "Faz: <name>" contract; the checkboxes must
    // not end in ": <name>" or the e2e `/: <name>$/` locator matches twice.
    expect(screen.queryAllByLabelText(/: Giriş$/)).toHaveLength(1)
  })
})

describe('issue #248 follow-up — English stays byte-identical', () => {
  it('config, results and sequence keep their English text', () => {
    useLocale('en')
    renderConfig()
    for (const s of [
      'Choose how to run your collection',
      'Run configuration',
      'Delay between requests',
      'Between iterations the runner waits 150 ms (100 + 50).',
      'Advanced Settings',
    ]) {
      expect(screen.getByText(s)).toBeTruthy()
    }
    expect(screen.getByTestId('runner-start').textContent).toBe('Start run')
    cleanup()

    renderResults()
    expect(screen.getByTestId('runner-results-title').textContent).toBe('Run results')
    expect(screen.getByText(/^Ran today at /)).toBeTruthy()
    expect(screen.getByText('Suite: Gece Kontrolü')).toBeTruthy()
    expect(screen.getByText('Iteration 1')).toBeTruthy()
    expect(screen.getByText('(3 requests, 1 failed)')).toBeTruthy()
    expect(within(screen.getByTestId('runner-results-list')).getByText('NOT RUN')).toBeTruthy()
    expect(screen.getByTestId('runner-filter-console').textContent).toBe('Console log 1')
    expect(screen.getByRole('button', { name: 'Response' })).toBeTruthy()
    cleanup()

    renderSequence()
    expect(screen.getByText('Run Sequence')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deselect All' })).toBeTruthy()
    expect(screen.getByLabelText('Select folder Kimlik')).toBeTruthy()
    expect(screen.getByLabelText('Select Giriş')).toBeTruthy()
  })
})
