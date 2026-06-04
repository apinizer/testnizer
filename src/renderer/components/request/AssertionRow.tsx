import { useState } from 'react'
import { X, Check, ToggleLeft, ToggleRight, Pencil } from 'lucide-react'
import type { TestAssertion } from '../../types'

const TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  status_equals: { color: 'var(--green)', bg: 'var(--green-bg)' },
  status_in_range: { color: 'var(--green)', bg: 'var(--green-bg)' },
  response_time_under: { color: '#0066cc', bg: '#e8f4ff' },
  response_size_under: { color: '#0066cc', bg: '#e8f4ff' },
  body_jsonpath: { color: '#b35a00', bg: '#fff4e0' },
  body_xpath: { color: '#b35a00', bg: '#fff4e0' },
  body_contains: { color: '#b35a00', bg: '#fff4e0' },
  body_equals_json: { color: '#b35a00', bg: '#fff4e0' },
  header_exists: { color: '#0066cc', bg: '#e8f4ff' },
  header_equals: { color: '#0066cc', bg: '#e8f4ff' },
  header_contains: { color: '#0066cc', bg: '#e8f4ff' },
}

interface AssertionRowProps {
  assertion: TestAssertion
  onUpdate: (updates: Partial<TestAssertion>) => void
  onRemove: () => void
}

export default function AssertionRow({ assertion, onUpdate, onRemove }: AssertionRowProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(assertion.name)
  const display = TYPE_STYLES[assertion.type] || { color: 'var(--muted)', bg: 'var(--surface)' }

  function commitName() {
    setEditingName(false)
    if (nameValue.trim() && nameValue !== assertion.name) {
      onUpdate({ name: nameValue.trim() })
    } else {
      setNameValue(assertion.name)
    }
  }

  return (
    <div
      className="mb-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--surface)]"
      style={{ opacity: assertion.enabled ? 1 : 0.5 }}
    >
      <div className="flex items-center gap-2 px-3 py-[7px]">
        <div
          className="h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: display.color }}
        />

        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setNameValue(assertion.name)
                setEditingName(false)
              }
            }}
            className="flex-1 rounded border border-[var(--accent)] bg-[var(--white)] px-1.5 py-0.5 text-[var(--text)] outline-none"
          />
        ) : (
          <span
            className="flex-1 cursor-pointer text-[var(--muted)] hover:text-[var(--text)]"
            onClick={() => {
              setNameValue(assertion.name)
              setEditingName(true)
            }}
          >
            {assertion.name}
          </span>
        )}

        <button
          type="button"
          onClick={() => {
            setNameValue(assertion.name)
            setEditingName(true)
          }}
          className="cursor-pointer bg-transparent p-0 text-[var(--hint)] hover:text-[var(--accent)]"
          style={{ border: 'none' }}
          title="Edit assertion name"
        >
          <Pencil size={12} />
        </button>

        <button
          type="button"
          onClick={() => onUpdate({ enabled: !assertion.enabled })}
          className="cursor-pointer bg-transparent p-0"
          style={{ border: 'none', color: assertion.enabled ? 'var(--accent)' : 'var(--hint)' }}
          title={assertion.enabled ? 'Disable' : 'Enable'}
        >
          {assertion.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer bg-transparent p-0 text-[var(--hint)] hover:text-[var(--red)]"
          style={{ border: 'none' }}
          title="Remove assertion"
        >
          <X size={12} />
        </button>
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2">
        <AssertionFields assertion={assertion} onUpdate={onUpdate} display={display} />
      </div>
    </div>
  )
}

function AssertionFields({
  assertion,
  onUpdate,
  display,
}: {
  assertion: TestAssertion
  onUpdate: (updates: Partial<TestAssertion>) => void
  display: { color: string; bg: string }
}) {
  const inputCls =
    'rounded border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]'

  switch (assertion.type) {
    case 'status_equals':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Expected status:</span>
          <input
            type="number"
            value={assertion.expected ?? 200}
            onChange={(e) => onUpdate({ expected: Number(e.target.value) })}
            className={`${inputCls} w-20`}
          />
          <BadgePill color={display.color} bg={display.bg}>
            {String(assertion.expected ?? 200)}
          </BadgePill>
        </div>
      )

    case 'status_in_range':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Range:</span>
          <input
            type="number"
            value={assertion.rangeMin ?? 200}
            onChange={(e) => onUpdate({ rangeMin: Number(e.target.value) })}
            className={`${inputCls} w-20`}
          />
          <span className="text-[var(--muted)]">to</span>
          <input
            type="number"
            value={assertion.rangeMax ?? 299}
            onChange={(e) => onUpdate({ rangeMax: Number(e.target.value) })}
            className={`${inputCls} w-20`}
          />
          <BadgePill color={display.color} bg={display.bg}>
            {assertion.rangeMin ?? 200}-{assertion.rangeMax ?? 299}
          </BadgePill>
        </div>
      )

    case 'body_contains':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Contains:</span>
          <input
            type="text"
            value={String(assertion.expected ?? '')}
            onChange={(e) => onUpdate({ expected: e.target.value })}
            placeholder="Search string..."
            className={`${inputCls} flex-1`}
          />
        </div>
      )

    case 'body_equals_json':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Expected JSON:</span>
          <input
            type="text"
            value={String(assertion.expected ?? '{}')}
            onChange={(e) => onUpdate({ expected: e.target.value })}
            placeholder='{"key": "value"}'
            className={`${inputCls} flex-1 font-mono`}
          />
        </div>
      )

    case 'body_jsonpath':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 text-[var(--muted)]">JSONPath:</span>
            <input
              type="text"
              value={assertion.jsonPath ?? ''}
              onChange={(e) => onUpdate({ jsonPath: e.target.value })}
              placeholder="$.data.items"
              className={`${inputCls} flex-1 font-mono`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[var(--muted)]">Expected:</span>
            <input
              type="text"
              value={String(assertion.expected ?? '')}
              onChange={(e) => onUpdate({ expected: e.target.value })}
              placeholder="Expected value"
              className={`${inputCls} flex-1`}
            />
          </div>
        </div>
      )

    case 'body_xpath':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 text-[var(--muted)]">XPath:</span>
            <input
              type="text"
              value={assertion.xPath ?? ''}
              onChange={(e) => onUpdate({ xPath: e.target.value })}
              placeholder="//element/text()"
              className={`${inputCls} flex-1 font-mono`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-[var(--muted)]">Expected:</span>
            <input
              type="text"
              value={String(assertion.expected ?? '')}
              onChange={(e) => onUpdate({ expected: e.target.value })}
              placeholder="Expected value"
              className={`${inputCls} flex-1`}
            />
          </div>
        </div>
      )

    case 'header_exists':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Header name:</span>
          <input
            type="text"
            value={assertion.headerName ?? ''}
            onChange={(e) => onUpdate({ headerName: e.target.value })}
            placeholder="Content-Type"
            className={`${inputCls} flex-1`}
          />
        </div>
      )

    case 'header_equals':
    case 'header_contains':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-20 text-[var(--muted)]">Header name:</span>
            <input
              type="text"
              value={assertion.headerName ?? ''}
              onChange={(e) => onUpdate({ headerName: e.target.value })}
              placeholder="Content-Type"
              className={`${inputCls} flex-1`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-[var(--muted)]">
              {assertion.type === 'header_equals' ? 'Equals:' : 'Contains:'}
            </span>
            <input
              type="text"
              value={String(assertion.expected ?? '')}
              onChange={(e) => onUpdate({ expected: e.target.value })}
              placeholder="application/json"
              className={`${inputCls} flex-1`}
            />
          </div>
        </div>
      )

    case 'response_time_under':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Max time:</span>
          <input
            type="number"
            value={assertion.expected ?? 2000}
            onChange={(e) => onUpdate({ expected: Number(e.target.value) })}
            className={`${inputCls} w-24`}
          />
          <span className="text-[var(--muted)]">ms</span>
          <BadgePill color={display.color} bg={display.bg}>
            {assertion.expected ?? 2000} ms
          </BadgePill>
        </div>
      )

    case 'response_size_under':
      return (
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Max size:</span>
          <input
            type="number"
            value={assertion.expected ?? 10240}
            onChange={(e) => onUpdate({ expected: Number(e.target.value) })}
            className={`${inputCls} w-24`}
          />
          <span className="text-[var(--muted)]">bytes</span>
          <BadgePill color={display.color} bg={display.bg}>
            {assertion.expected ?? 10240} B
          </BadgePill>
        </div>
      )

    default:
      return (
        <div className="flex items-center gap-2">
          <Check size={12} className="text-[var(--green)]" />
          <span className="text-[var(--muted)]">Configured</span>
        </div>
      )
  }
}

function BadgePill({
  color,
  bg,
  children,
}: {
  color: string
  bg: string
  children: React.ReactNode
}) {
  return (
    <span className="rounded px-[7px] py-[1px] font-mono" style={{ color, background: bg }}>
      {children}
    </span>
  )
}
