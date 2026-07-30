import KeyMaterialField from '../../shared/KeyMaterialField'
import { useTranslation } from '../../../lib/i18n'
import type { SamlVerifyFormState } from '../../../lib/tools/saml'
import { Check, Field, INPUT, Pane, TEXTAREA } from './fields'

/**
 * Verify tab.
 *
 * The certificate pasted here is the TRUST ANCHOR (E-2): main verifies against
 * it and NEVER against the certificate embedded in the document's KeyInfo.
 * The keystore picker is one added way to name that same anchor.
 */
export default function VerifyForm({
  form,
  patch,
}: {
  form: SamlVerifyFormState
  patch: (p: Partial<SamlVerifyFormState>) => void
}) {
  const { t } = useTranslation()
  // A keystore selection wins over the pasted trust anchor, so the textarea is
  // disabled rather than left editable-but-ignored.
  const usingSource = form.keySource !== null

  return (
    <Pane>
      <textarea
        className={TEXTAREA}
        placeholder={t('tools.saml.trustCertPlaceholder')}
        value={form.certPem}
        disabled={usingSource}
        onChange={(e) => patch({ certPem: e.target.value })}
      />
      <div className="text-[10px]" style={{ color: 'var(--hint)' }}>
        {t('tools.saml.trustCertHint')}
      </div>

      <KeyMaterialField
        value={form.keySource}
        label={form.keySourceLabel}
        filter="any"
        hint={t('tools.saml.trustKeystoreHint')}
        onChange={(sel) => {
          patch({
            keySource: sel ? sel.source : null,
            keySourceLabel: sel ? sel.label : null,
          })
        }}
      />

      <div className="grid grid-cols-2 gap-2">
        <Field label={t('tools.saml.expectedAudience')}>
          <input
            className={INPUT}
            value={form.expectedAudience}
            onChange={(e) => patch({ expectedAudience: e.target.value })}
          />
        </Field>
        <Field label={t('tools.saml.expectedInResponseTo')}>
          <input
            className={INPUT}
            value={form.expectedInResponseTo}
            onChange={(e) => patch({ expectedInResponseTo: e.target.value })}
          />
        </Field>
        <Field label={t('tools.saml.clockSkew')}>
          <input
            className={INPUT}
            type="number"
            min={0}
            value={form.clockSkewSeconds}
            onChange={(e) => patch({ clockSkewSeconds: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Check
          label={t('tools.saml.requireAssertionSigned')}
          checked={form.requireAssertionSigned}
          onChange={(v) => patch({ requireAssertionSigned: v })}
        />
        <Check
          label={t('tools.saml.validateConditions')}
          checked={form.validateConditions}
          onChange={(v) => patch({ validateConditions: v })}
        />
      </div>
    </Pane>
  )
}
