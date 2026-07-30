import { useMemo, useRef, useState, type DragEvent } from 'react'
import ToolShell from './ToolShell'
import { encodeQrDataUrl, decodeQrFromFile, type QrEcLevel } from '../../lib/tools/qr'
import { useTranslation } from '../../lib/i18n'

type Mode = 'encode' | 'decode'
const EC_LEVELS: QrEcLevel[] = ['L', 'M', 'Q', 'H']

export default function QrTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('encode')

  // encode state
  const [text, setText] = useState('')
  const [ecLevel, setEcLevel] = useState<QrEcLevel>('M')

  // decode state
  const [decoded, setDecoded] = useState<string | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const encoded = useMemo(() => {
    if (!text.trim()) return { url: null as string | null, error: null as string | null }
    try {
      return { url: encodeQrDataUrl(text, { cellSize: 6, ecLevel }), error: null }
    } catch (e) {
      return { url: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text, ecLevel])

  function downloadPng(): void {
    if (!encoded.url) return
    const a = document.createElement('a')
    a.href = encoded.url
    // The encoder produces a PNG data URL; the extension said GIF, so saved
    // files opened with the wrong association on some systems.
    a.download = 'qrcode.png'
    a.click()
  }

  async function handleFile(file: File | undefined | null): Promise<void> {
    if (!file) return
    setDecoded(null)
    setDecodeError(null)
    try {
      setDecoded(await decodeQrFromFile(file))
    } catch (e) {
      setDecodeError(e instanceof Error ? e.message : String(e))
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    setDragOver(false)
    void handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <ToolShell
      title={t('tools.qr.title')}
      toolbar={
        <div className="flex gap-1">
          {(['encode', 'decode'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="rounded px-3 py-1 text-xs font-semibold"
              style={{
                background: mode === m ? 'var(--accentLight)' : 'var(--white)',
                color: mode === m ? 'var(--accentText)' : 'var(--muted)',
                border: '1px solid',
                borderColor: mode === m ? 'var(--accentText)' : 'var(--border)',
              }}
            >
              {m === 'encode' ? t('tools.qr.modeEncode') : t('tools.qr.modeDecode')}
            </button>
          ))}
        </div>
      }
      inputPane={
        mode === 'encode' ? (
          <div className="flex h-full flex-col p-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('tools.qr.inputPlaceholder')}
              className="min-h-0 flex-1 resize-none rounded border p-2 text-sm font-mono"
              style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
            />
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('tools.qr.ecLevel')}
              </label>
              <select
                value={ecLevel}
                onChange={(e) => setEcLevel(e.target.value as QrEcLevel)}
                className="rounded border px-2 py-1 text-xs"
                style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
              >
                {EC_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col p-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed p-6 text-center"
              style={{
                borderColor: dragOver ? 'var(--accentText)' : 'var(--border)',
                background: dragOver ? 'var(--accentLight)' : 'var(--surface)',
                color: 'var(--muted)',
              }}
            >
              <div className="text-3xl">⬇</div>
              <div className="text-xs">{t('tools.qr.dropHint')}</div>
            </div>
          </div>
        )
      }
      outputPane={
        mode === 'encode' ? (
          encoded.error ? (
            <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
              {encoded.error}
            </div>
          ) : !encoded.url ? (
            <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
              {t('tools.qr.hint')}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
              <img
                src={encoded.url}
                alt="QR code"
                width={220}
                height={220}
                style={{ imageRendering: 'pixelated', background: '#fff', padding: 8 }}
              />
              <button
                onClick={downloadPng}
                className="rounded px-3 py-1 text-xs font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                {t('tools.qr.download')}
              </button>
            </div>
          )
        ) : decodeError ? (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            {decodeError}
          </div>
        ) : decoded == null ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.qr.decodeHint')}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div
              className="shrink-0 flex items-center justify-between border-b px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <span style={{ color: 'var(--muted)' }}>{t('tools.qr.decoded')}</span>
              <button
                onClick={() => navigator.clipboard.writeText(decoded).catch(() => {})}
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--white)',
                  color: 'var(--muted)',
                }}
              >
                ⧉ {t('tools.common.copy')}
              </button>
            </div>
            <div
              className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-sm"
              style={{ color: 'var(--text)' }}
            >
              {decoded}
            </div>
          </div>
        )
      }
    />
  )
}
