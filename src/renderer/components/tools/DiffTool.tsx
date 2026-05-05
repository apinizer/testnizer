import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { computeDiff, renderUnifiedDiff, type DiffMode } from '../../lib/tools/diff'
import { useTranslation } from '../../lib/i18n'

export default function DiffTool() {
  const { t } = useTranslation()
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [mode, setMode] = useState<DiffMode>('lines')
  const [ignoreWs, setIgnoreWs] = useState(false)
  const [ignoreCase, setIgnoreCase] = useState(false)

  const result = useMemo(
    () => computeDiff(left, right, { mode, ignoreWhitespace: ignoreWs, ignoreCase }),
    [left, right, mode, ignoreWs, ignoreCase],
  )

  const unified = renderUnifiedDiff(result)

  const toolbar = (
    <>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as DiffMode)}
        className="rounded border px-2 py-1 text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', color: 'var(--text)' }}
        aria-label={t('tools.diff.mode')}
      >
        <option value="lines">{t('tools.diff.modeLines')}</option>
        <option value="words">{t('tools.diff.modeWords')}</option>
        <option value="chars">{t('tools.diff.modeChars')}</option>
      </select>
      <label
        className="flex cursor-pointer items-center gap-1.5 text-xs"
        style={{ color: 'var(--text)' }}
      >
        <input type="checkbox" checked={ignoreWs} onChange={(e) => setIgnoreWs(e.target.checked)} />
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
    </>
  )

  return (
    <ToolShell
      title={t('tools.diff.title')}
      toolbar={toolbar}
      inputLabel={t('tools.diff.left')}
      outputLabel={t('tools.diff.right')}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={left} onChange={setLeft} language="plaintext" />
          </div>
          <div style={{ height: 1, background: 'var(--border)' }} />
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={right} onChange={setRight} language="plaintext" />
          </div>
        </div>
      }
      outputPane={<MonacoWrapper value={unified} language="diff" readOnly />}
      footer={
        <div className="flex items-center gap-4">
          <span style={{ color: '#1a7a4a' }}>
            +{result.added} {t('tools.diff.added')}
          </span>
          <span style={{ color: '#cc2200' }}>
            -{result.removed} {t('tools.diff.removed')}
          </span>
        </div>
      }
    />
  )
}
