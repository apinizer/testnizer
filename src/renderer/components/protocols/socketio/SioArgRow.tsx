import { X } from 'lucide-react'
import { SIO_ARG_CONTENT_TYPES, type SioArg } from '../../../../shared/realtime'
import { useSocketIOStore } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'
import ContentTypeSelect from '../realtime/ContentTypeSelect'

const PLACEHOLDER: Record<SioArg['contentType'], string> = {
  json: '{"key": "value"}',
  text: 'text',
  base64: 'SGVsbG8=',
  hex: '48 65 6c 6c 6f',
}

/**
 * One emit argument (issue #283): its format (Text / JSON / Binary as Base64
 * or Hex — Postman's per-argument formats) and content. `{{var}}` is resolved
 * at Emit. The first argument's textarea keeps the pre-#283 hook
 * `socketio-payload`.
 */
export default function SioArgRow({
  arg,
  index,
  removable,
}: {
  arg: SioArg
  index: number
  removable: boolean
}) {
  const { t } = useTranslation()
  const updateArg = useSocketIOStore((s) => s.updateArg)
  const removeArg = useSocketIOStore((s) => s.removeArg)
  const label = t('socketio.argLabel').replace('{n}', String(index + 1))
  return (
    <div data-testid="socketio-arg" className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--muted)]">{label}</span>
        <ContentTypeSelect
          value={arg.contentType}
          options={SIO_ARG_CONTENT_TYPES}
          onChange={(contentType) => updateArg(arg.id, { contentType })}
          testId="socketio-arg-format"
          ariaLabel={t('socketio.argFormat').replace('{n}', String(index + 1))}
        />
        {removable && (
          <button
            type="button"
            onClick={() => removeArg(arg.id)}
            aria-label={t('socketio.removeArg').replace('{n}', String(index + 1))}
            data-testid="socketio-arg-remove"
            className="ml-auto flex h-6 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:text-[var(--red)]"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <textarea
        value={arg.content}
        onChange={(e) => updateArg(arg.id, { content: e.target.value })}
        rows={3}
        spellCheck={false}
        aria-label={label}
        placeholder={PLACEHOLDER[arg.contentType]}
        data-testid={index === 0 ? 'socketio-payload' : 'socketio-arg-content'}
        className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--white)] p-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  )
}
