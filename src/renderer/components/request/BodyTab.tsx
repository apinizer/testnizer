import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import KeyValueTable from '../shared/KeyValueTable'
import type { BodyType, KeyValuePair } from '../../types'

const BODY_OPTIONS: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'form-data', label: 'form-data' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'json', label: 'raw' },
  { value: 'binary', label: 'binary' },
]

const RAW_FORMATS: { value: BodyType; label: string; lang: string }[] = [
  { value: 'json', label: 'JSON', lang: 'json' },
  { value: 'xml', label: 'XML', lang: 'xml' },
  { value: 'text', label: 'Text', lang: 'plaintext' },
  { value: 'html', label: 'HTML', lang: 'html' },
  { value: 'javascript', label: 'JavaScript', lang: 'javascript' },
]

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

const isRawType = (t: BodyType) => ['json', 'xml', 'text', 'html', 'javascript'].includes(t)

export default function BodyTab() {
  const body = useRequestStore((s) => s.body)
  const setBody = useRequestStore((s) => s.setBody)

  const handleTypeChange = (type: BodyType) => {
    setBody({ ...body, type })
  }

  const handleContentChange = (content: string) => {
    setBody({ ...body, content })
  }

  const handleBeautify = () => {
    if (body.type === 'json' && body.content) {
      try {
        const formatted = JSON.stringify(JSON.parse(body.content), null, 2)
        setBody({ ...body, content: formatted })
      } catch { /* ignore */ }
    }
    if (body.type === 'xml' && body.content) {
      // Basic XML prettify
      let formatted = body.content.replace(/></g, '>\n<')
      let indent = 0
      formatted = formatted
        .split('\n')
        .map((line) => {
          const trimmed = line.trim()
          if (trimmed.startsWith('</')) indent = Math.max(0, indent - 1)
          const padded = '  '.repeat(indent) + trimmed
          if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.startsWith('<?') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
            indent++
          }
          return padded
        })
        .join('\n')
      setBody({ ...body, content: formatted })
    }
  }

  const handleFormDataUpdate = (id: string, updates: Partial<KeyValuePair>) => {
    const formData = (body.formData || []).map((item) =>
      item.id === id ? { ...item, ...updates } : item
    )
    setBody({ ...body, formData })
  }

  const handleFormDataRemove = (id: string) => {
    setBody({ ...body, formData: (body.formData || []).filter((item) => item.id !== id) })
  }

  const handleFormDataAdd = () => {
    const newItem: KeyValuePair = { id: makeId(), key: '', value: '', enabled: true }
    setBody({ ...body, formData: [...(body.formData || []), newItem] })
  }

  const handleUrlEncodedUpdate = (id: string, updates: Partial<KeyValuePair>) => {
    const urlEncoded = (body.urlEncoded || []).map((item) =>
      item.id === id ? { ...item, ...updates } : item
    )
    setBody({ ...body, urlEncoded })
  }

  const handleBinaryPick = async () => {
    try {
      const res = await window.api?.dialog?.openFile?.({
        title: 'Select binary file',
      })
      if (res?.success && res.data && !Array.isArray(res.data)) {
        setBody({ ...body, binaryPath: res.data.filePath })
      }
    } catch {
      /* user cancelled or no dialog */
    }
  }

  const handleBinaryClear = () => {
    setBody({ ...body, binaryPath: undefined })
  }

  const handleUrlEncodedRemove = (id: string) => {
    setBody({ ...body, urlEncoded: (body.urlEncoded || []).filter((item) => item.id !== id) })
  }

  const handleUrlEncodedAdd = () => {
    const newItem: KeyValuePair = { id: makeId(), key: '', value: '', enabled: true }
    setBody({ ...body, urlEncoded: [...(body.urlEncoded || []), newItem] })
  }

  const monacoLanguage = body.type === 'xml' ? 'xml'
    : body.type === 'json' ? 'json'
    : body.type === 'html' ? 'html'
    : body.type === 'javascript' ? 'javascript'
    : 'plaintext'

  // Determine which top-level radio is selected
  const activeRadio = isRawType(body.type) ? 'json' as BodyType : body.type

  return (
    <div className="flex h-full flex-col">
      {/* Body type selector — Postman-style radio buttons */}
      <div className="flex shrink-0 items-center gap-3 pb-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
        {BODY_OPTIONS.map((opt) => {
          const isActive = opt.value === activeRadio
          return (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-1.5"
              style={{ color: isActive ? 'var(--text)' : 'var(--muted)' }}
            >
              <input
                type="radio"
                name="bodyType"
                checked={isActive}
                onChange={() => handleTypeChange(opt.value)}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13, margin: 0 }}
              />
              {opt.label}
            </label>
          )
        })}

        {/* Raw format dropdown — shown when raw is selected (like Postman) */}
        {isRawType(body.type) && (
          <>
            <span className="text-[var(--border2)]">|</span>
            <select
              value={body.type}
              onChange={(e) => handleTypeChange(e.target.value as BodyType)}
              className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-px font-medium text-[var(--accent-text)] outline-none"
            >
              {RAW_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </>
        )}

        {/* Spacer + Beautify button */}
        <div className="flex-1" />
        {isRawType(body.type) && (body.type === 'json' || body.type === 'xml') && (
          <button
            type="button"
            onClick={handleBeautify}
            className="cursor-pointer rounded border border-[var(--border)] bg-transparent px-2 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
          >
            Beautify
          </button>
        )}
      </div>

      {/* Content area */}
      {body.type === 'none' && (
        <div className="flex flex-1 items-center justify-center text-[var(--hint)]">
          This request does not have a body.
        </div>
      )}

      {isRawType(body.type) && (
        <div className="flex-1 overflow-hidden pt-1">
          <MonacoWrapper
            value={body.content || ''}
            onChange={handleContentChange}
            language={monacoLanguage}
            height="100%"
          />
        </div>
      )}

      {body.type === 'form-data' && (
        <div className="flex-1 overflow-auto pt-1">
          <KeyValueTable
            rows={body.formData || []}
            onUpdate={handleFormDataUpdate}
            onRemove={handleFormDataRemove}
            onAdd={handleFormDataAdd}
            addLabel="+ Add Field"
            enableFileType
          />
        </div>
      )}

      {body.type === 'urlencoded' && (
        <div className="flex-1 overflow-auto pt-1">
          <KeyValueTable
            rows={body.urlEncoded || []}
            onUpdate={handleUrlEncodedUpdate}
            onRemove={handleUrlEncodedRemove}
            onAdd={handleUrlEncodedAdd}
            addLabel="+ Add Field"
          />
        </div>
      )}

      {body.type === 'binary' && (
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--white)] p-3 text-center">
            <button
              type="button"
              onClick={handleBinaryPick}
              className="cursor-pointer rounded border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {body.binaryPath ? 'Change File' : 'Select File'}
            </button>
            {body.binaryPath && (
              <div className="mt-1.5 flex items-center justify-center gap-2 text-[var(--muted)]">
                <span className="truncate" style={{ maxWidth: 360 }}>{body.binaryPath}</span>
                <button
                  type="button"
                  onClick={handleBinaryClear}
                  className="cursor-pointer border-none bg-transparent text-[var(--muted)] hover:text-[var(--accent)]"
                  title="Clear file"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
