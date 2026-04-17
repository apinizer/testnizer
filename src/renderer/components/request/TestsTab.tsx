import { useState, useRef, useEffect } from 'react'
import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import AssertionRow from './AssertionRow'
import type { AssertionType, TestAssertion } from '../../types'

interface AssertionCategory {
  label: string
  items: { type: AssertionType; label: string }[]
}

const ASSERTION_CATEGORIES: AssertionCategory[] = [
  {
    label: 'Status',
    items: [
      { type: 'status_equals', label: 'Status code equals' },
      { type: 'status_in_range', label: 'Status code in range (200-299)' },
    ],
  },
  {
    label: 'Body',
    items: [
      { type: 'body_contains', label: 'Body contains' },
      { type: 'body_equals_json', label: 'Body equals JSON' },
      { type: 'body_jsonpath', label: 'Body JSON path' },
      { type: 'body_xpath', label: 'Body XPath' },
    ],
  },
  {
    label: 'Headers',
    items: [
      { type: 'header_exists', label: 'Header exists' },
      { type: 'header_equals', label: 'Header equals' },
      { type: 'header_contains', label: 'Header contains' },
    ],
  },
  {
    label: 'Performance',
    items: [
      { type: 'response_time_under', label: 'Response time under' },
      { type: 'response_size_under', label: 'Response size under' },
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
  const assertions = useRequestStore((s) => s.assertions)
  const setAssertions = useRequestStore((s) => s.setAssertions)
  const removeAssertion = useRequestStore((s) => s.removeAssertion)
  const postScript = useRequestStore((s) => s.postScript)
  const setPostScript = useRequestStore((s) => s.setPostScript)

  const [showPicker, setShowPicker] = useState(false)
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

  const defaultScript = postScript || `pm.test("Status is 200", () => {
  pm.expect(pm.response.code).to.equal(200);
});`

  return (
    <div>
      <div className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
        Visual Assertions
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
          className="mb-3 mt-1 w-full cursor-pointer rounded-[7px] border border-dashed border-[var(--border2)] bg-transparent py-[5px] text-[var(--hint)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          + Add Assertion
        </button>

        {showPicker && (
          <div
            ref={pickerRef}
            className="absolute left-0 right-0 top-full z-50 max-h-[320px] overflow-auto rounded-[10px] border border-[var(--border)] bg-[var(--white)] py-1"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
          >
            {ASSERTION_CATEGORIES.map((cat) => (
              <div key={cat.label}>
                <div className="px-3 pb-0.5 pt-2 font-semibold uppercase tracking-wider text-[var(--hint)]">
                  {cat.label}
                </div>
                {cat.items.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handlePickType(item.type, item.label)}
                    className="flex w-full cursor-pointer items-center gap-2 bg-transparent px-3 py-1.5 text-left text-[var(--text)] transition-colors hover:bg-[var(--accent-light)]"
                    style={{ border: 'none' }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--white)]">
        <MonacoWrapper
          value={defaultScript}
          onChange={setPostScript}
          language="javascript"
          height={140}
        />
      </div>
    </div>
  )
}
