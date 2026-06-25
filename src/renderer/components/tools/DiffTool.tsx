import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import {
  computeSideBySide,
  computeDiffBlocks,
  computeFindMatches,
  type SideBySideResult,
  type SideBySideRow,
  type Segment,
  type FindMatchRange,
} from '../../lib/tools/diff'
import { useTranslation } from '../../lib/i18n'

export default function DiffTool() {
  const { t } = useTranslation()
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [ignoreWs, setIgnoreWs] = useState(false)
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [result, setResult] = useState<SideBySideResult | null>(null)
  // Bumped on every compare so the result view remounts fresh (resets find/nav state).
  const [runId, setRunId] = useState(0)

  function handleCompare() {
    setResult(computeSideBySide(left, right, { ignoreWhitespace: ignoreWs, ignoreCase }))
    setRunId((n) => n + 1)
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
          <SideBySideDiff key={runId} result={result} />
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

  const rowsRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  // Diff-block navigation
  const diffBlocks = useMemo(() => computeDiffBlocks(result.rows), [result.rows])
  const [activeBlock, setActiveBlock] = useState(-1)

  // Find-in-result
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const { matches: findMatches, map: matchMap } = useMemo(
    () => (findOpen ? computeFindMatches(result.rows, query) : { matches: [], map: new Map() }),
    [findOpen, query, result.rows],
  )

  const scrollToRow = useCallback((rowIndex: number) => {
    const el = rowsRef.current?.querySelector(`[data-row-index="${rowIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  // Changing the query restarts navigation from the first match.
  const handleQueryChange = useCallback((v: string) => {
    setQuery(v)
    setActiveMatch(0)
  }, [])

  // Scroll the active match into view.
  useEffect(() => {
    if (!findOpen) return
    const m = findMatches[activeMatch]
    if (m) scrollToRow(m.rowIndex)
  }, [activeMatch, findMatches, findOpen, scrollToRow])

  // Focus the find input when the bar opens.
  useEffect(() => {
    if (findOpen) findInputRef.current?.focus()
  }, [findOpen])

  // Ctrl/Cmd+F opens the result find bar — unless focus is in the input editors
  // (Monaco), where the editor's own find should win.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== 'f' && e.key !== 'F')) return
      const el = document.activeElement as HTMLElement | null
      const inEditor =
        !!el &&
        (!!el.closest?.('.monaco-editor') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (inEditor) return
      e.preventDefault()
      setFindOpen(true)
      findInputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const gotoBlock = useCallback(
    (dir: 1 | -1) => {
      if (diffBlocks.length === 0) return
      setActiveBlock((cur) => {
        const next =
          cur < 0
            ? dir > 0
              ? 0
              : diffBlocks.length - 1
            : (cur + dir + diffBlocks.length) % diffBlocks.length
        scrollToRow(diffBlocks[next].start)
        return next
      })
    },
    [diffBlocks, scrollToRow],
  )

  const gotoMatch = useCallback(
    (dir: 1 | -1) => {
      if (findMatches.length === 0) return
      setActiveMatch((cur) => (cur + dir + findMatches.length) % findMatches.length)
    },
    [findMatches.length],
  )

  const activeBlockRange = activeBlock >= 0 ? diffBlocks[activeBlock] : null
  const navDisabled = diffBlocks.length === 0

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

      {/* Navigation toolbar */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1"
        style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
      >
        <div className="flex items-center gap-1">
          <NavButton
            label="↑"
            title={t('tools.diff.prevDiff')}
            disabled={navDisabled}
            onClick={() => gotoBlock(-1)}
          />
          <NavButton
            label="↓"
            title={t('tools.diff.nextDiff')}
            disabled={navDisabled}
            onClick={() => gotoBlock(1)}
          />
          <span className="ml-1 text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
            {diffBlocks.length === 0
              ? t('tools.diff.noDiffs')
              : `${activeBlock < 0 ? '–' : activeBlock + 1} / ${diffBlocks.length}`}
          </span>
        </div>
        <NavButton
          label={`⌕ ${t('tools.diff.find')}`}
          title={t('tools.diff.find')}
          onClick={() => setFindOpen((v) => !v)}
          active={findOpen}
        />
      </div>

      {/* Aligned rows */}
      <div ref={rowsRef} className="relative flex-1 overflow-auto font-mono text-xs">
        {findOpen && (
          <FindBar
            inputRef={findInputRef}
            query={query}
            onQueryChange={handleQueryChange}
            current={findMatches.length === 0 ? 0 : activeMatch + 1}
            total={findMatches.length}
            onPrev={() => gotoMatch(-1)}
            onNext={() => gotoMatch(1)}
            onClose={() => setFindOpen(false)}
          />
        )}
        {result.rows.length === 0 ? (
          <div className="p-3" style={{ color: 'var(--muted)' }}>
            {t('tools.diff.identical')}
          </div>
        ) : (
          result.rows.map((row, i) => (
            <Row
              key={i}
              index={i}
              row={row}
              leftWidth={leftWidth}
              rightWidth={rightWidth}
              matchMap={matchMap}
              activeMatchIndex={findMatches.length ? activeMatch : -1}
              inActiveBlock={
                !!activeBlockRange && i >= activeBlockRange.start && i < activeBlockRange.end
              }
            />
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
function NavButton({
  label,
  title,
  onClick,
  disabled,
  active,
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border px-1.5 py-0.5 text-[11px] leading-none disabled:opacity-40"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        color: active ? 'var(--accentText)' : 'var(--text)',
        background: active ? 'var(--accentLight)' : 'var(--white)',
      }}
    >
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
function FindBar({
  inputRef,
  query,
  onQueryChange,
  current,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (v: string) => void
  current: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="sticky top-1 z-10 ml-auto mr-2 flex w-fit items-center gap-1.5 rounded border px-1.5 py-1 shadow-sm"
      style={{ borderColor: 'var(--border2)', background: 'var(--white)' }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder={t('tools.diff.findPlaceholder')}
        className="w-44 rounded border px-2 py-0.5 text-xs outline-none"
        style={{ borderColor: 'var(--border)', color: 'var(--text)', background: 'var(--surface)' }}
      />
      <span
        className="min-w-12 px-1 text-center text-[11px] tabular-nums"
        style={{ color: 'var(--muted)' }}
      >
        {query === '' ? '' : total === 0 ? t('tools.diff.noMatches') : `${current} / ${total}`}
      </span>
      <NavButton
        label="↑"
        title={t('tools.diff.findPrev')}
        onClick={onPrev}
        disabled={total === 0}
      />
      <NavButton
        label="↓"
        title={t('tools.diff.findNext')}
        onClick={onNext}
        disabled={total === 0}
      />
      <NavButton label="✕" title={t('tools.diff.findClose')} onClick={onClose} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
function Row({
  index,
  row,
  leftWidth,
  rightWidth,
  matchMap,
  activeMatchIndex,
  inActiveBlock,
}: {
  index: number
  row: SideBySideRow
  leftWidth: number
  rightWidth: number
  matchMap: Map<string, FindMatchRange[]>
  activeMatchIndex: number
  inActiveBlock: boolean
}) {
  return (
    <div
      className="flex"
      data-row-index={index}
      style={inActiveBlock ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
    >
      <Cell
        side="left"
        rowIndex={index}
        num={row.leftNum}
        numWidth={leftWidth}
        rowKind={row.kind}
        segments={row.leftSegments}
        matchMap={matchMap}
        activeMatchIndex={activeMatchIndex}
      />
      <Cell
        side="right"
        rowIndex={index}
        num={row.rightNum}
        numWidth={rightWidth}
        rowKind={row.kind}
        segments={row.rightSegments}
        matchMap={matchMap}
        activeMatchIndex={activeMatchIndex}
      />
    </div>
  )
}

function Cell({
  side,
  rowIndex,
  num,
  numWidth,
  rowKind,
  segments,
  matchMap,
  activeMatchIndex,
}: {
  side: 'left' | 'right'
  rowIndex: number
  num?: number
  numWidth: number
  rowKind: SideBySideRow['kind']
  segments?: Segment[]
  matchMap: Map<string, FindMatchRange[]>
  activeMatchIndex: number
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
        {num ?? ' '}
      </div>
      <div className="min-w-0 flex-1 whitespace-pre px-2 py-0.5 break-all">
        {segments && segments.length > 0
          ? segments.map((s, i) => (
              <SegmentSpan
                key={i}
                seg={s}
                matches={matchMap.get(`${rowIndex}:${side}:${i}`)}
                activeMatchIndex={activeMatchIndex}
              />
            ))
          : ' '}
      </div>
    </div>
  )
}

function segmentBaseStyle(seg: Segment): React.CSSProperties {
  if (seg.kind === 'removed') {
    return { background: 'rgba(204, 34, 0, 0.22)', color: '#8a1a00', borderRadius: 2 }
  }
  if (seg.kind === 'added') {
    return { background: 'rgba(26, 122, 74, 0.22)', color: '#0e5a35', borderRadius: 2 }
  }
  return { color: 'var(--text)' }
}

function SegmentSpan({
  seg,
  matches,
  activeMatchIndex,
}: {
  seg: Segment
  matches?: FindMatchRange[]
  activeMatchIndex: number
}) {
  const base = segmentBaseStyle(seg)
  if (!matches || matches.length === 0) {
    return <span style={base}>{seg.value}</span>
  }

  // Split the segment text around the matched ranges, wrapping each hit in a
  // highlight. The active match gets a stronger accent.
  const parts: ReactNode[] = []
  let cursor = 0
  matches.forEach((m, i) => {
    if (m.start > cursor) {
      parts.push(<span key={`t${i}`}>{seg.value.slice(cursor, m.start)}</span>)
    }
    const isActive = m.globalIndex === activeMatchIndex
    parts.push(
      <mark
        key={`m${i}`}
        data-find-active={isActive ? 'true' : undefined}
        style={{
          padding: 0,
          borderRadius: 2,
          color: '#1a1a2e',
          background: isActive ? '#ff9b21' : 'rgba(255, 213, 0, 0.55)',
          boxShadow: isActive ? '0 0 0 1px #d97700' : undefined,
        }}
      >
        {seg.value.slice(m.start, m.start + m.length)}
      </mark>,
    )
    cursor = m.start + m.length
  })
  if (cursor < seg.value.length) {
    parts.push(<span key="end">{seg.value.slice(cursor)}</span>)
  }
  return <span style={base}>{parts}</span>
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
