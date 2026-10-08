import { useTranslation } from '../../lib/i18n'
import {
  MOCK_MCP_ERROR_KINDS,
  type MockMcpErrorKind,
  type MockMcpErrorMode,
} from '../../types/mock-mcp'
import { Field, INPUT_CLS, OptionalIntInput } from './ui'

const KIND_LABEL_KEYS: Record<MockMcpErrorKind, string> = {
  none: 'mockMcp.error.kind.none',
  jsonrpc: 'mockMcp.error.kind.jsonrpc',
  isError: 'mockMcp.error.kind.isError',
  timeout: 'mockMcp.error.kind.timeout',
  http: 'mockMcp.error.kind.http',
}

const KIND_HINT_KEYS: Record<MockMcpErrorKind, string> = {
  none: 'mockMcp.error.hint.none',
  jsonrpc: 'mockMcp.error.hint.jsonrpc',
  isError: 'mockMcp.error.hint.isError',
  timeout: 'mockMcp.error.hint.timeout',
  http: 'mockMcp.error.hint.http',
}

const INHERIT = '__inherit__'

/**
 * Error injection knobs for `tools/call`. Used for the server-wide mode and,
 * with `allowInherit`, for a per-tool override (`undefined` = use the
 * server's mode).
 */
export default function MockMcpErrorModeFields({
  value,
  onChange,
  allowInherit,
  testIdPrefix,
}: {
  value: MockMcpErrorMode | undefined
  onChange: (mode: MockMcpErrorMode | undefined) => void
  allowInherit?: boolean
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const kind = value?.kind
  const set = (patch: Partial<MockMcpErrorMode>): void =>
    onChange({ ...(value ?? { kind: 'none' }), ...patch })

  return (
    <div className="flex flex-col gap-2">
      <Field label={allowInherit ? t('mockMcp.error.override') : t('mockMcp.error.mode')}>
        <select
          data-testid={`${testIdPrefix}-kind`}
          value={kind ?? INHERIT}
          onChange={(e) => {
            const next = e.target.value
            if (next === INHERIT) onChange(undefined)
            else set({ kind: next as MockMcpErrorKind })
          }}
          className={INPUT_CLS}
        >
          {allowInherit && <option value={INHERIT}>{t('mockMcp.error.inherit')}</option>}
          {MOCK_MCP_ERROR_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABEL_KEYS[k])}
            </option>
          ))}
        </select>
      </Field>
      {kind && <div className="text-[11px] text-[var(--hint)]">{t(KIND_HINT_KEYS[kind])}</div>}
      {kind && kind !== 'none' && (
        <div className="grid grid-cols-2 gap-3">
          {kind === 'jsonrpc' && (
            <Field label={t('mockMcp.error.code')}>
              <OptionalIntInput
                testId={`${testIdPrefix}-code`}
                value={value?.code}
                min={-2147483648}
                max={2147483647}
                placeholder="-32603"
                onChange={(code) => set({ code })}
              />
            </Field>
          )}
          {(kind === 'jsonrpc' || kind === 'isError') && (
            <Field label={t('mockMcp.error.message')}>
              <input
                data-testid={`${testIdPrefix}-message`}
                value={value?.message ?? ''}
                onChange={(e) => set({ message: e.target.value })}
                className={INPUT_CLS}
              />
            </Field>
          )}
          {kind === 'http' && (
            <Field label={t('mockMcp.error.httpStatus')}>
              <OptionalIntInput
                testId={`${testIdPrefix}-http-status`}
                value={value?.httpStatus}
                min={400}
                max={599}
                placeholder="500"
                onChange={(httpStatus) => set({ httpStatus })}
              />
            </Field>
          )}
          <Field label={t('mockMcp.error.everyN')}>
            <OptionalIntInput
              testId={`${testIdPrefix}-every-n`}
              value={value?.everyN}
              min={1}
              max={1000000}
              placeholder="1"
              onChange={(everyN) => set({ everyN })}
            />
          </Field>
        </div>
      )}
    </div>
  )
}
