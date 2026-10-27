import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, File as FileIcon } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import MonacoWrapper from '../shared/MonacoWrapper'

/** Decode a base64 string into a Blob of the given MIME type (null on failure). */
function base64ToBlob(b64: string, contentType: string): Blob | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: contentType || 'application/octet-stream' })
  } catch {
    return null
  }
}

/** Best-effort file extension for a content type, for the download filename. */
function extForContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/octet-stream': 'bin',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  return map[ct] || 'bin'
}

function formatBytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Preview / download panel for binary response bodies (issue #25). The body
 * arrives base64-encoded; we rebuild an in-memory Blob and an object URL so
 * images render inline, audio / video play in place (CSP allows `blob:` for
 * media-src), and anything else offers a Download.
 *
 * PDFs open in the system viewer instead of an iframe (issue #294): Chromium
 * will not run its PDF viewer in a `sandbox`ed frame, and an untrusted body
 * must not render in an unsandboxed frame of the app's own document.
 */
export default function BinaryResponseView({
  base64,
  contentType,
  size,
}: {
  base64: string
  contentType: string
  size?: number
}) {
  // Decode to a Blob in a memo (pure — a Blob needs no cleanup), but create and
  // revoke the object URL INSIDE the effect. React StrictMode (dev) mounts the
  // component, runs the cleanup once to surface effect bugs, then remounts. The
  // old code created the URL during render (useMemo) and revoked it in a
  // separate `[url]` effect, so the StrictMode cleanup revoked the URL while the
  // memo kept handing that now-dead URL to <img>/<a> — the preview showed a
  // broken image and Download saved nothing. Creating + revoking the URL in one
  // effect keeps a live URL across the remount (issue #25).
  const { t } = useTranslation()
  const blob = useMemo(() => base64ToBlob(base64, contentType), [base64, contentType])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  // Rendered preview vs. the raw base64 the body actually holds. Postman lets
  // you flip a binary response between its preview and raw bytes; offer the
  // same so an image isn't a dead-end with no way back to the source
  // (issue #25 follow-up).
  const [binView, setBinView] = useState<'preview' | 'raw'>('preview')

  const isImage = contentType.startsWith('image/')
  const isPdf = contentType === 'application/pdf'
  const isAudio = contentType.startsWith('audio/')
  const isVideo = contentType.startsWith('video/')
  const filename = `response.${extForContentType(contentType)}`

  const [openingPdf, setOpeningPdf] = useState(false)
  async function openPdf(): Promise<void> {
    setOpeningPdf(true)
    try {
      const r = (await window.api?.response?.openPdf(base64)) as
        | { success: boolean; error?: string }
        | undefined
      if (!r?.success) {
        toast.error(t('response.binary.openPdfFailed'), { description: r?.error })
      }
    } finally {
      setOpeningPdf(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Meta + download bar */}
      <div
        className="flex shrink-0 items-center gap-3 px-3"
        style={{ height: 32, borderBottom: '1px solid var(--border)', background: 'var(--white)' }}
      >
        <span style={{ color: 'var(--muted)', fontSize: 13 }} data-testid="res-binary-type">
          {contentType || t('response.binary.type')}
        </span>
        {size != null && (
          <span style={{ color: 'var(--hint)', fontSize: 13 }}>{formatBytes(size)}</span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          {(['preview', 'raw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setBinView(m)}
              data-testid={`res-binary-view-${m}`}
              className="cursor-pointer rounded px-2 py-[3px] transition-colors"
              style={{
                background: binView === m ? 'var(--accent-light)' : 'transparent',
                border: 'none',
                color: binView === m ? 'var(--accent-text)' : 'var(--muted)',
                fontWeight: binView === m ? 600 : 400,
                fontSize: 13,
              }}
            >
              {m === 'preview' ? t('response.view.preview') : t('response.view.raw')}
            </button>
          ))}
        </div>
        {url && (
          <a
            href={url}
            download={filename}
            data-testid="res-binary-download"
            className="flex items-center gap-1 rounded px-2 py-[3px]"
            style={{
              color: 'var(--accent-text)',
              background: 'var(--accent-light)',
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            <Download size={13} /> {t('response.binary.download')}
          </a>
        )}
      </div>

      {/* Content: rendered preview, or the raw base64 the body holds */}
      {binView === 'raw' ? (
        <div className="flex-1 overflow-hidden bg-[var(--white)]" data-testid="res-binary-raw">
          <MonacoWrapper
            value={base64}
            language="plaintext"
            readOnly
            lineNumbers="on"
            height="100%"
            wordWrap={true}
          />
        </div>
      ) : (
        <div
          className="flex flex-1 items-center justify-center overflow-auto p-4"
          style={{ background: 'var(--surface)' }}
          data-testid="res-binary-preview"
        >
          {!blob ? (
            <span style={{ color: 'var(--muted)' }}>{t('response.binary.decodeFailed')}</span>
          ) : !url ? null : isImage ? (
            <img
              src={url}
              alt={t('response.binary.imageAlt')}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          ) : isPdf ? (
            <div
              className="flex flex-col items-center gap-2 text-center"
              data-testid="res-binary-pdf"
            >
              <FileIcon size={40} style={{ color: 'var(--muted)' }} />
              <div style={{ color: 'var(--text)' }}>{t('response.binary.pdfTitle')}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{formatBytes(size)}</div>
              <button
                type="button"
                onClick={() => void openPdf()}
                disabled={openingPdf}
                data-testid="res-binary-open-pdf"
                className="mt-1 flex cursor-pointer items-center gap-1 rounded px-2 py-[3px] disabled:cursor-default disabled:opacity-60"
                style={{
                  color: 'var(--accent-text)',
                  background: 'var(--accent-light)',
                  border: 'none',
                  fontSize: 13,
                }}
              >
                <ExternalLink size={13} /> {t('response.binary.openPdf')}
              </button>
              <div style={{ color: 'var(--hint)', fontSize: 12, maxWidth: 360 }}>
                {t('response.binary.openPdfHint')}
              </div>
            </div>
          ) : isAudio ? (
            <audio controls src={url} />
          ) : isVideo ? (
            <video controls src={url} style={{ maxWidth: '100%', maxHeight: '100%' }} />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <FileIcon size={40} style={{ color: 'var(--muted)' }} />
              <div style={{ color: 'var(--text)' }}>{contentType || t('response.binary.file')}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{formatBytes(size)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
