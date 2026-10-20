import { useState } from 'react'
import { Download, ImageOff } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import { base64ByteLength, downloadBase64, inspectImageData } from './mcp-content'

interface Props {
  data: string
  mimeType: string
  alt: string
  testId: string
  /** Extra classes; sizing is owned here so every call site behaves the same. */
  className?: string
  /** File name for the fallback's Download button; omit when the caller already offers one. */
  downloadName?: string
}

/**
 * An inline base64 image that degrades gracefully (issue #209): when the
 * browser cannot decode it (truncated or corrupt data), the broken-image icon
 * is replaced by "Image could not be displayed · N bytes · mime" and, when
 * `downloadName` is given, a Download button for the raw bytes.
 *
 * Issue #215: when the bytes are structurally cut short (see
 * `inspectImageData`) the text says so — the server sent incomplete data —
 * and the button reads "Download as received": it writes exactly the
 * base64-decoded `data` field, which is what the server sent, so a broken
 * image downloads broken. Testnizer never alters the payload.
 *
 * Sizing (issue #209 follow-up): the image keeps its intrinsic size and is
 * only scaled DOWN. Every parent is a flex column (align-items: stretch), so
 * without `self-start` + `w-auto` a 20×20 icon was stretched to the full
 * result width and blurred.
 */
const IMG_SIZING = 'block h-auto w-auto max-h-80 max-w-full self-start object-contain'

export default function McpImage({ data, mimeType, alt, testId, className, downloadName }: Props) {
  const { t } = useTranslation()
  const src = `data:${mimeType};base64,${data}`
  // Remembering WHICH src failed resets the fallback when a new image arrives.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (failedSrc !== src) {
    return (
      <img
        data-testid={testId}
        src={src}
        alt={alt}
        className={className ? `${IMG_SIZING} ${className}` : IMG_SIZING}
        onError={() => setFailedSrc(src)}
      />
    )
  }
  const incomplete = inspectImageData(data, mimeType) === 'incomplete'
  return (
    <div
      data-testid="mcp-image-fallback"
      data-incomplete={incomplete ? 'true' : undefined}
      className="flex flex-wrap items-center gap-2 self-start rounded-md border border-dashed border-[var(--border)] px-2.5 py-1.5 text-[12px] text-[var(--muted)]"
    >
      <ImageOff size={13} className="shrink-0" />
      <span>
        {t(incomplete ? 'mcp.result.imageIncomplete' : 'mcp.result.imageFailed')
          .replace('{bytes}', String(base64ByteLength(data)))
          .replace('{mime}', mimeType || '?')}
      </span>
      {downloadName && (
        <button
          type="button"
          data-testid="mcp-image-download"
          onClick={() => downloadBase64(data, mimeType, downloadName)}
          className="flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-transparent px-2 py-0.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface)]"
        >
          <Download size={12} />
          {t('mcp.result.downloadAsReceived')}
        </button>
      )}
    </div>
  )
}
