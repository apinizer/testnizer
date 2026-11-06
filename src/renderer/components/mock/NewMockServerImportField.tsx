/**
 * The file row of the "New mock server" dialog's Import option: choose a file,
 * see what it is. Explicit button: arrowing through the starting points must not
 * throw up a file dialog.
 */
import { useRef } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { GhostButton } from '../mock-mcp/ui'
import { MOCK_IMPORT_ACCEPT, type MockImportFile } from './mock-import-file'

const FORMAT_LABEL = { openapi: 'OpenAPI', postman: 'Postman' } as const

export default function NewMockServerImportField({
  file,
  error,
  reading,
  disabled,
  onPick,
}: {
  file: MockImportFile | null
  error: string | null
  reading: boolean
  disabled: boolean
  onPick: (file: File) => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div data-testid="mock-new-import" className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={MOCK_IMPORT_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="mock-new-import-input"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            // Cleared so choosing the same file again (after fixing it) fires a change.
            e.target.value = ''
            if (picked) onPick(picked)
          }}
        />
        <GhostButton
          data-testid="mock-new-import-choose"
          disabled={disabled || reading}
          onClick={() => inputRef.current?.click()}
        >
          {reading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
          {file ? t('mockNew.importChange') : t('mockNew.importChoose')}
        </GhostButton>
        {file && (
          <span
            data-testid="mock-new-import-summary"
            title={file.fileName}
            className="min-w-0 truncate text-[11px] text-[var(--muted)]"
          >
            {file.fileName} · {FORMAT_LABEL[file.format]} ·{' '}
            {formatCount(
              file.endpointCount,
              t('mock.importEndpointCountOne'),
              t('mock.importEndpointCount'),
            )}
          </span>
        )}
      </div>
      {error && (
        <p
          data-testid="mock-new-import-error"
          role="alert"
          className="text-[11px] text-[var(--red)]"
        >
          {error}
        </p>
      )}
    </div>
  )
}
