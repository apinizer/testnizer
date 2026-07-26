import { useTranslation } from '../../../lib/i18n'
import { SAML_BINDINGS, type SamlBindingFormState } from '../../../lib/tools/saml'
import type { SamlBinding } from '../../../types'
import { Check, Field, INPUT, Pane, TEXTAREA } from './fields'

/** Encode / Decode tab — HTTP-Redirect (DEFLATE+base64) and HTTP-POST (base64). */
export default function BindingForm({
  form,
  patch,
}: {
  form: SamlBindingFormState
  patch: (p: Partial<SamlBindingFormState>) => void
}) {
  const { t } = useTranslation()

  return (
    <Pane>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('tools.saml.binding')}>
          <select
            className={INPUT}
            value={form.binding}
            onChange={(e) => patch({ binding: e.target.value as SamlBinding })}
          >
            {SAML_BINDINGS.map((b) => (
              <option key={b} value={b}>
                {t(`tools.saml.binding.${b}`)}
              </option>
            ))}
          </select>
        </Field>
        {form.binding === 'redirect' && (
          <div className="flex items-end pb-1">
            <Check
              label={t('tools.saml.urlEncode')}
              checked={form.urlEncode}
              onChange={(v) => patch({ urlEncode: v })}
            />
          </div>
        )}
      </div>
      <Field label={t('tools.saml.encodedPayload')}>
        <textarea
          className={TEXTAREA}
          placeholder={t('tools.saml.encodedPlaceholder')}
          value={form.encoded}
          onChange={(e) => patch({ encoded: e.target.value })}
        />
      </Field>
      <div className="text-[10px]" style={{ color: 'var(--hint)' }}>
        {t('tools.saml.bindingHint')}
      </div>
    </Pane>
  )
}
