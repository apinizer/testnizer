import { useEffect, useRef } from 'react'
import { Download, Link2 } from 'lucide-react'
import type { McpResourceContents } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import { JsonPre } from './ui'
import {
  base64ByteLength,
  base64ToBlob,
  canMakeObjectUrl,
  downloadBase64,
  fileNameFromUri,
  isContentBlock,
  prettyIfJson,
} from './mcp-content'

const PRE = 'm-0 whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text)]'

/**
 * Audio from base64 — via a blob URL (the CSP allows `media-src blob:`, not
 * `data:`). Set imperatively on the element so StrictMode's effect replay
 * creates a fresh URL instead of reusing a revoked one.
 */
function AudioBlock({ data, mimeType }: { data: string; mimeType: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (!canMakeObjectUrl()) return
    const blob = base64ToBlob(data, mimeType)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    if (ref.current) ref.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [data, mimeType])
  return <audio ref={ref} controls data-testid="mcp-block-audio" data-mime={mimeType} />
}

function EmbeddedResource({ resource }: { resource: McpResourceContents }) {
  const { t } = useTranslation()
  const mime = resource.mimeType ?? ''
  return (
    <div data-testid="mcp-block-resource" className="rounded-md border border-[var(--border)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text)]">
          {resource.uri}
        </span>
        {mime && <span className="shrink-0 text-[11px] text-[var(--muted)]">{mime}</span>}
      </div>
      <div className="p-2.5">
        {resource.text !== undefined ? (
          <pre className={PRE}>{prettyIfJson(resource.text)}</pre>
        ) : resource.blob !== undefined ? (
          <div className="flex flex-col gap-2">
            {mime.startsWith('image/') && (
              <img
                src={`data:${mime};base64,${resource.blob}`}
                alt={resource.uri}
                className="max-h-80 max-w-full self-start rounded"
              />
            )}
            <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
              <span data-testid="mcp-resource-binary">
                {t('mcp.result.binary').replace('{bytes}', String(base64ByteLength(resource.blob)))}
              </span>
              <button
                type="button"
                data-testid="mcp-resource-download"
                onClick={() =>
                  downloadBase64(
                    resource.blob ?? '',
                    resource.mimeType,
                    fileNameFromUri(resource.uri),
                  )
                }
                className="flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-transparent px-2 py-0.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface)]"
              >
                <Download size={12} />
                {t('mcp.result.download')}
              </button>
            </div>
          </div>
        ) : (
          <span className="text-[12px] text-[var(--muted)]">{t('mcp.result.empty')}</span>
        )}
      </div>
    </div>
  )
}

/** One MCP content block (tool result, resource contents, prompt message). */
export default function McpContentBlockView({ block }: { block: unknown }) {
  if (!isContentBlock(block)) return <JsonPre value={block} testId="mcp-block-json" />
  switch (block.type) {
    case 'text':
      return (
        <pre data-testid="mcp-block-text" className={PRE}>
          {prettyIfJson(block.text ?? '')}
        </pre>
      )
    case 'image':
      return (
        <img
          data-testid="mcp-block-image"
          src={`data:${block.mimeType};base64,${block.data}`}
          alt={block.mimeType}
          className="max-h-80 max-w-full rounded"
        />
      )
    case 'audio':
      return <AudioBlock data={block.data} mimeType={block.mimeType} />
    case 'resource':
      return <EmbeddedResource resource={block.resource} />
    case 'resource_link':
      return (
        <div
          data-testid="mcp-block-resource-link"
          className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5"
        >
          <Link2 size={13} className="shrink-0 text-[var(--muted)]" />
          {block.name && <span className="font-medium text-[var(--text)]">{block.name}</span>}
          <span className="min-w-0 truncate font-mono text-[11px] text-[var(--accent-text)]">
            {block.uri}
          </span>
          {block.mimeType && (
            <span className="ml-auto shrink-0 text-[11px] text-[var(--muted)]">
              {block.mimeType}
            </span>
          )}
        </div>
      )
  }
  return <JsonPre value={block} testId="mcp-block-json" />
}
