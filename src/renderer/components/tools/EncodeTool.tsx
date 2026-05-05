import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { ENCODERS, type EncoderId } from '../../lib/tools/encoders'
import { useTranslation } from '../../lib/i18n'

const ENCODER_IDS: EncoderId[] = ['base64', 'base64url', 'url', 'hex', 'html', 'unicode']

export default function EncodeTool() {
  const { t } = useTranslation()
  const [active, setActive] = useState<EncoderId>('base64')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleEncode = () => {
    const r = ENCODERS[active].encode(input)
    if (r.ok) {
      setOutput(r.output)
      setError(null)
    } else {
      setOutput('')
      setError(r.error)
    }
  }

  const handleDecode = () => {
    const r = ENCODERS[active].decode(input)
    if (r.ok) {
      setOutput(r.output)
      setError(null)
    } else {
      setOutput('')
      setError(r.error)
    }
  }

  const handleClear = () => {
    setInput('')
    setOutput('')
    setError(null)
  }

  const toolbar = (
    <>
      <button
        onClick={handleEncode}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('tools.encode.encode')}
      </button>
      <button
        onClick={handleDecode}
        className="rounded border px-3 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {t('tools.encode.decode')}
      </button>
      <button
        onClick={handleClear}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.clear')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.encode.title')}
      toolbar={toolbar}
      inputLabel={t('tools.common.input')}
      outputLabel={t('tools.common.output')}
      inputPane={
        <div className="flex h-full flex-col">
          <div
            className="flex shrink-0 gap-1 border-b px-2 py-1"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {ENCODER_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setActive(id)}
                className="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  background: active === id ? 'var(--accent-light)' : 'transparent',
                  color: active === id ? 'var(--accent-text)' : 'var(--muted)',
                }}
              >
                {ENCODERS[id].label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={input} onChange={setInput} language="plaintext" />
          </div>
        </div>
      }
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : (
          <MonacoWrapper value={output} language="plaintext" readOnly />
        )
      }
    />
  )
}
