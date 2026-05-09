import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import {
  computeSideBySide,
  type SideBySideResult,
  type SideBySideRow,
  type Segment,
} from '../../lib/tools/diff'
import { useTranslation } from '../../lib/i18n'

export default function DiffTool() {
  const { t } = useTranslation()
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [ignoreWs, setIgnoreWs] = useState(false)
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [result, setResult] = useState<SideBySideResult | null>(null)

  function handleCompare() {
    setResult(computeSideBySide(left, right, { ignoreWhitespace: ignoreWs, ignoreCase }))
  }

  function handleSwap() {
    setLeft(right)
    setRight(left)
    setResult(null)
  }

  function handleClear() {
    setLeft('')
    setRight('')
    setResult(null)
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Top bar */}
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <h2 className="m-0 text-base font-semibold" style={{ color: 'var(--heading)' }}>
          {t('tools.diff.title')}
        </h2>
        <div className="flex items-center gap-3">
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={ignoreWs}
              onChange={(e) => setIgnoreWs(e.target.checked)}
            />
            {t('tools.diff.ignoreWhitespace')}
          </label>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={(e) => setIgnoreCase(e.target.checked)}
            />
            {t('tools.diff.ignoreCase')}
          </label>
          <button
            onClick={handleSwap}
            className="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text)',
              background: 'var(--white)',
            }}
            title={t('tools.diff.swap')}
          >
            {t('tools.diff.swap')}
          </button>
          <button
            onClick={handleClear}
            className="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text)',
              background: 'var(--white)',
            }}
          >
            {t('tools.common.clear')}
          </button>
          <button
            onClick={handleCompare}
            className="rounded px-3 py-1 text-xs font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            {t('tools.common.compare')}
          </button>
        </div>
      </div>

      {/* Inputs: side-by-side editors */}
      <div className="flex shrink-0" style={{ height: '40%' }}>
        <div
          className="flex min-w-0 flex-1 flex-col border-r"
          style={{ borderColor: 'var(--border)' }}
        >
          <PaneHeader title={t('tools.diff.leftSide')} text={left} />
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={left} onChange={setLeft} language="plaintext" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <PaneHeader title={t('tools.diff.rightSide')} text={right} />
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={right} onChange={setRight} language="plaintext" />
          </div>
        </div>
      </div>

      {/* Result */}
      <div
        className="flex min-h-0 flex-1 flex-col border-t"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        {result ? (
          <SideBySideDiff result={result} />
        ) : (
          <div className="p-4 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.diff.compareHint')}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
function PaneHeader({ title, text }: { title: string; text: string }) {
  const lineCount = text === '' ? 0 : text.split('\n').length
  const { t } = useTranslation()
  return (
    <div
      className="flex shrink-0 items-center justify-between border-b px-3 py-1.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <span
        className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {title}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {lineCount} {t('tools.diff.lines')}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
function SideBySideDiff({ result }: { result: SideBySideResult }) {
  const { t } = useTranslation()
  const leftWidth = useMemo(() => Math.max(2, String(result.leftLines).length), [result.leftLines])
  const rightWidth = useMemo(
    () => Math.max(2, String(result.rightLines).length),
    [result.rightLines],
  )

  const leftText = useMemo(() => rowsToText(result.rows, 'left'), [result.rows])
  const rightText = useMemo(() => rowsToText(result.rows, 'right'), [result.rows])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stats header */}
      <div
        className="flex shrink-0 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="flex flex-1 items-center justify-between border-r px-3 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <span
            className="flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: '#cc2200' }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>−</span>
            {result.removals} {t('tools.diff.removalsLabel')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {result.leftLines} {t('tools.diff.lines')}
            </span>
            <CopyButton text={leftText} />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-between px-3 py-1.5">
          <span
            className="flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: '#1a7a4a' }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
            {result.additions} {t('tools.diff.additionsLabel')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {result.rightLines} {t('tools.diff.lines')}
            </span>
            <CopyButton text={rightText} />
          </div>
        </div>
      </div>

      {/* Aligned rows */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {result.rows.length === 0 ? (
          <div className="p-3" style={{ color: 'var(--muted)' }}>
            {t('tools.diff.identical')}
          </div>
        ) : (
          result.rows.map((row, i) => (
            <Row key={i} row={row} leftWidth={leftWidth} rightWidth={rightWidth} />
          ))
        )}
      </div>
    </div>
  )
}

function rowsToText(rows: SideBySideRow[], side: 'left' | 'right'): string {
  return rows
    .map((r) => {
      const segs = side === 'left' ? r.leftSegments : r.rightSegments
      if (!segs) return ''
      return segs.map((s) => s.value).join('')
    })
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────
function Row({
  row,
  leftWidth,
  rightWidth,
}: {
  row: SideBySideRow
  leftWidth: number
  rightWidth: number
}) {
  return (
    <div className="flex">
      <Cell
        side="left"
        num={row.leftNum}
        numWidth={leftWidth}
        rowKind={row.kind}
        segments={row.leftSegments}
      />
      <Cell
        side="right"
        num={row.rightNum}
        numWidth={rightWidth}
        rowKind={row.kind}
        segments={row.rightSegments}
      />
    </div>
  )
}

function Cell({
  side,
  num,
  numWidth,
  rowKind,
  segments,
}: {
  side: 'left' | 'right'
  num?: number
  numWidth: number
  rowKind: SideBySideRow['kind']
  segments?: Segment[]
}) {
  const isRemovedSide = side === 'left' && (rowKind === 'removed' || rowKind === 'modify')
  const isAddedSide = side === 'right' && (rowKind === 'added' || rowKind === 'modify')
  const isPlaceholder =
    (side === 'left' && (rowKind === 'added' || num === undefined)) ||
    (side === 'right' && (rowKind === 'removed' || num === undefined))

  const bg = isPlaceholder
    ? 'transparent'
    : isRemovedSide
      ? 'rgba(204, 34, 0, 0.06)'
      : isAddedSide
        ? 'rgba(26, 122, 74, 0.07)'
        : 'transparent'

  return (
    <div
      className="flex min-w-0 flex-1 border-r"
      style={{
        borderColor: 'var(--border)',
        background: bg,
        backgroundImage: isPlaceholder
          ? 'repeating-linear-gradient(135deg, rgba(0,0,0,0.025) 0 6px, transparent 6px 12px)'
          : undefined,
      }}
    >
      <div
        className="shrink-0 select-none border-r px-2 py-0.5 text-right tabular-nums"
        style={{
          borderColor: 'var(--border)',
          background: isPlaceholder ? 'transparent' : 'var(--surface)',
          color: 'var(--muted)',
          minWidth: `${numWidth + 2}ch`,
        }}
      >
        {num ?? ' '}
      </div>
      <div className="min-w-0 flex-1 whitespace-pre px-2 py-0.5 break-all">
        {segments && segments.length > 0
          ? segments.map((s, i) => <SegmentSpan key={i} seg={s} />)
          : ' '}
      </div>
    </div>
  )
}

function SegmentSpan({ seg }: { seg: Segment }) {
  if (seg.kind === 'removed') {
    return (
      <span
        style={{
          background: 'rgba(204, 34, 0, 0.22)',
          color: '#8a1a00',
          borderRadius: 2,
        }}
      >
        {seg.value}
      </span>
    )
  }
  if (seg.kind === 'added') {
    return (
      <span
        style={{
          background: 'rgba(26, 122, 74, 0.22)',
          color: '#0e5a35',
          borderRadius: 2,
        }}
      >
        {seg.value}
      </span>
    )
  }
  return <span style={{ color: 'var(--text)' }}>{seg.value}</span>
}

// ─────────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={copied ? t('tools.common.copied') : t('tools.common.copy')}
      className="rounded border px-1.5 py-0.5 text-[11px]"
      style={{
        borderColor: 'var(--border)',
        color: copied ? '#1a7a4a' : 'var(--muted)',
        background: 'var(--white)',
      }}
    >
      {copied ? '✓ ' : '⧉ '}
      {t('tools.common.copy')}
    </button>
  )
}
