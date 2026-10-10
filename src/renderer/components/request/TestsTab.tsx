import { useState, useRef, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import ScriptHelpModal from '../shared/ScriptHelpModal'
import { useTranslation } from '../../lib/i18n'
import AssertionRow from './AssertionRow'
import type { AssertionType, TestAssertion } from '../../types'

// i18n keys (issue #193). The picked item's label also becomes the new
// assertion's default name, so a Turkish UI names it in Turkish.
interface AssertionCategory {
  labelKey: string
  items: { type: AssertionType; labelKey: string }[]
}

const ASSERTION_CATEGORIES: AssertionCategory[] = [
  {
    labelKey: 'testsTab.catStatus',
    items: [
      { type: 'status_equals', labelKey: 'tests.statusCodeEquals' },
      { type: 'status_in_range', labelKey: 'testsTab.statusInRange' },
    ],
  },
  {
    labelKey: 'testsTab.catBody',
    items: [
      { type: 'body_contains', labelKey: 'tests.bodyContains' },
      { type: 'body_equals_json', labelKey: 'testsTab.bodyEqualsJson' },
      { type: 'body_jsonpath', labelKey: 'testsTab.bodyJsonPath' },
      { type: 'body_xpath', labelKey: 'testsTab.bodyXPath' },
    ],
  },
  {
    labelKey: 'testsTab.catHeaders',
    items: [
      { type: 'header_exists', labelKey: 'tests.headerExists' },
      { type: 'header_equals', labelKey: 'tests.headerEquals' },
      { type: 'header_contains', labelKey: 'testsTab.headerContains' },
    ],
  },
  {
    labelKey: 'testsTab.catPerformance',
    items: [
      { type: 'response_time_under', labelKey: 'testsTab.responseTimeUnder' },
      { type: 'response_size_under', labelKey: 'testsTab.responseSizeUnder' },
    ],
  },
]

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function defaultsForType(type: AssertionType): Partial<TestAssertion> {
  switch (type) {
    case 'status_equals':
      return { expected: 200 }
    case 'status_in_range':
      return { rangeMin: 200, rangeMax: 299 }
    case 'body_contains':
      return { expected: '' }
    case 'body_equals_json':
      return { expected: '{}' }
    case 'body_jsonpath':
      return { jsonPath: '$.data', expected: '' }
    case 'body_xpath':
      return { xPath: '', expected: '' }
    case 'header_exists':
      return { headerName: '' }
    case 'header_equals':
      return { headerName: '', expected: '' }
    case 'header_contains':
      return { headerName: '', expected: '' }
    case 'response_time_under':
      return { expected: 2000 }
    case 'response_size_under':
      return { expected: 10240 }
    default:
      return {}
  }
}

export default function TestsTab() {
  const { t } = useTranslation()
  const assertions = useRequestStore((s) => s.assertions)
  const setAssertions = useRequestStore((s) => s.setAssertions)
  const removeAssertion = useRequestStore((s) => s.removeAssertion)
  const postScript = useRequestStore((s) => s.postScript)
  const setPostScript = useRequestStore((s) => s.setPostScript)

  const [showPicker, setShowPicker] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setShowPicker(false)
      }
    }
    if (showPicker) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPicker])

  function handlePickType(type: AssertionType, label: string) {
    const defaults = defaultsForType(type)
    const newAssertion: TestAssertion = {
      id: makeId(),
      name: label,
      type,
      enabled: true,
      ...defaults,
    }
    setAssertions([...assertions, newAssertion])
    setShowPicker(false)
  }

  function handleUpdate(id: string, updates: Partial<TestAssertion>) {
    setAssertions(assertions.map((a) => (a.id === id ? { ...a, ...updates } : a)))
  }

  // Example script used as a one-click starter when the post-response script
  // field is empty. We intentionally do NOT pass this as the editor's `value`
  // when `postScript` is empty: doing that would *display* the example without
  // ever writing it back into the store via `onChange`, so `sendRequest()`
  // would still see an empty script and the Test Results tab would show
  // "No tests were run for this request" even though the user can clearly see
  // a `pm.test(...)` call in the editor. Render the editor against the real
  // value and surface the example via an explicit "Insert example" button.
  const EXAMPLE_SCRIPT = `pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});`

  return (
    <div>
      <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
        {t('tests.visualAssertions')}
      </div>

      {assertions.map((assertion) => (
        <AssertionRow
          key={assertion.id}
          assertion={assertion}
          onUpdate={(updates) => handleUpdate(assertion.id, updates)}
          onRemove={() => removeAssertion(assertion.id)}
        />
      ))}

      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          data-testid="tests-add-assertion"
          className="mb-3 mt-1 w-full cursor-pointer rounded-[7px] border border-dashed border-[var(--border2)] bg-transparent py-[5px] text-[var(--hint)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          {t('testsTab.addAssertion')}
        </button>

        {showPicker && (
          <div
            ref={pickerRef}
            className="absolute left-0 right-0 top-full z-50 max-h-[320px] overflow-auto rounded-[10px] border border-[var(--border)] bg-[var(--white)] py-1"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
          >
            {ASSERTION_CATEGORIES.map((cat) => (
              <div key={cat.labelKey}>
                <div className="px-3 pb-0.5 pt-2 font-semibold uppercase tracking-wider text-[var(--hint)]">
                  {t(cat.labelKey)}
                </div>
                {cat.items.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handlePickType(item.type, t(item.labelKey))}
                    className="flex w-full cursor-pointer items-center gap-2 bg-transparent px-3 py-1.5 text-left text-[var(--text)] transition-colors hover:bg-[var(--accent-light)]"
                    style={{ border: 'none' }}
                  >
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <div className="font-medium" style={{ color: 'var(--text)' }}>
          {t('testsTab.postScript')}
        </div>
        <div className="flex items-center gap-2">
          {!postScript && (
            <button
              type="button"
              onClick={() => setPostScript(EXAMPLE_SCRIPT)}
              className="cursor-pointer rounded px-2 py-0.5"
              style={{
                background: 'transparent',
                border: '1px solid var(--border2)',
                color: 'var(--accent-text)',
                fontSize: 12,
              }}
            >
              {t('scripts.insertExample')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5"
            style={{
              background: 'transparent',
              border: '1px solid var(--border2)',
              color: 'var(--muted)',
              fontSize: 12,
            }}
            title={t('scriptHelp.title')}
          >
            <HelpCircle size={12} />
            {t('scriptHelp.title')}
          </button>
        </div>
      </div>
      <div
        className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--white)]"
        data-testid="tests-post-script"
      >
        <MonacoWrapper
          value={postScript}
          onChange={setPostScript}
          language="javascript"
          height={140}
        />
      </div>

      <ScriptHelpModal open={showHelp} onClose={() => setShowHelp(false)} variant="post" />
    </div>
  )
}
