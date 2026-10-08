import { useState, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { McpAuthConfig } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'

const INPUT =
  'h-8 w-full min-w-0 rounded-md border border-[var(--border)] px-2.5 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]'

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--muted)]">
      {label}
      {children}
    </label>
  )
}

/** `{{var}}`-aware text field (environment autocomplete on `{{`). */
function TextField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  testId: string
}) {
  return (
    <FieldLabel label={props.label}>
      <VariableAutocompleteInput
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        className={INPUT}
        data-testid={props.testId}
      />
    </FieldLabel>
  )
}

/** Masked field with a show / hide toggle (AuthTab's `PasswordInput` is module-private). */
function SecretField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  testId: string
}) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  return (
    <FieldLabel label={props.label}>
      <span className="relative flex">
        <input
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          data-testid={props.testId}
          className={`${INPUT} bg-[var(--white)] pr-8`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          data-testid={`${props.testId}-toggle`}
          aria-label={show ? t('mcp.auth.hidePassword') : t('mcp.auth.showPassword')}
          className="absolute top-1/2 right-1.5 flex -translate-y-1/2 cursor-pointer border-none bg-transparent p-0.5 text-[var(--muted)] hover:text-[var(--text)]"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </span>
    </FieldLabel>
  )
}

interface FieldsProps {
  auth: McpAuthConfig
  onChange: (auth: McpAuthConfig) => void
}

export function McpBasicAuthFields({ auth, onChange }: FieldsProps) {
  const { t } = useTranslation()
  const basic = auth.basic ?? { username: '', password: '' }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <TextField
        label={t('mcp.auth.username')}
        value={basic.username}
        onChange={(username) => onChange({ ...auth, basic: { ...basic, username } })}
        placeholder="{{username}}"
        testId="mcp-auth-basic-username"
      />
      <SecretField
        label={t('mcp.auth.password')}
        value={basic.password}
        onChange={(password) => onChange({ ...auth, basic: { ...basic, password } })}
        placeholder="{{password}}"
        testId="mcp-auth-basic-password"
      />
    </div>
  )
}

export function McpBearerAuthFields({ auth, onChange }: FieldsProps) {
  const { t } = useTranslation()
  const bearer = auth.bearer ?? { token: '' }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
      <TextField
        label={t('mcp.auth.token')}
        value={bearer.token}
        onChange={(token) => onChange({ ...auth, bearer: { ...bearer, token } })}
        placeholder="{{token}}"
        testId="mcp-auth-bearer-token"
      />
      <TextField
        label={t('mcp.auth.prefix')}
        value={bearer.prefix ?? ''}
        onChange={(prefix) => onChange({ ...auth, bearer: { ...bearer, prefix } })}
        placeholder="Bearer"
        testId="mcp-auth-bearer-prefix"
      />
    </div>
  )
}

export function McpApiKeyAuthFields({ auth, onChange }: FieldsProps) {
  const { t } = useTranslation()
  const apiKey = auth.apiKey ?? { key: '', value: '', in: 'header' as const }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_140px]">
      <TextField
        label={t('mcp.auth.key')}
        value={apiKey.key}
        onChange={(key) => onChange({ ...auth, apiKey: { ...apiKey, key } })}
        placeholder="X-API-Key"
        testId="mcp-auth-apikey-key"
      />
      <TextField
        label={t('mcp.auth.value')}
        value={apiKey.value}
        onChange={(value) => onChange({ ...auth, apiKey: { ...apiKey, value } })}
        placeholder="{{apiKey}}"
        testId="mcp-auth-apikey-value"
      />
      <FieldLabel label={t('mcp.auth.addTo')}>
        <select
          value={apiKey.in}
          onChange={(e) =>
            onChange({
              ...auth,
              apiKey: { ...apiKey, in: e.target.value === 'query' ? 'query' : 'header' },
            })
          }
          data-testid="mcp-auth-apikey-in"
          className="h-8 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="header">{t('mcp.auth.addTo.header')}</option>
          <option value="query">{t('mcp.auth.addTo.query')}</option>
        </select>
      </FieldLabel>
    </div>
  )
}
