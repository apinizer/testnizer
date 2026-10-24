import type { RtContentType } from '../../../../shared/realtime'
import { useTranslation } from '../../../lib/i18n'

const LABEL_KEYS: Record<RtContentType, string> = {
  text: 'rt.format.text',
  json: 'rt.format.json',
  xml: 'rt.format.xml',
  html: 'rt.format.html',
  base64: 'rt.format.base64',
  hex: 'rt.format.hex',
}

/**
 * Message / argument format picker shared by the WebSocket composer and each
 * Socket.IO argument (issues #282 / #283). Postman's list: Text, JSON, XML,
 * HTML and Binary as Base64 or Hexadecimal (grouped under "Binary").
 * Fixed height, no `py-*` (select-no-clip rule).
 */
export default function ContentTypeSelect<T extends RtContentType>({
  value,
  options,
  onChange,
  testId,
  ariaLabel,
}: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  testId: string
  ariaLabel?: string
}) {
  const { t } = useTranslation()
  const plain = options.filter((o) => o !== 'base64' && o !== 'hex')
  const binary = options.filter((o) => o === 'base64' || o === 'hex')
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      data-testid={testId}
      aria-label={ariaLabel ?? t('rt.format.label')}
      className="h-8 shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
    >
      {plain.map((o) => (
        <option key={o} value={o}>
          {t(LABEL_KEYS[o])}
        </option>
      ))}
      {binary.length > 0 && (
        <optgroup label={t('rt.format.binary')}>
          {binary.map((o) => (
            <option key={o} value={o}>
              {t(LABEL_KEYS[o])}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
