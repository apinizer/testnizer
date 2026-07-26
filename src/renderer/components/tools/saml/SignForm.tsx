import KeyMaterialField from '../../shared/KeyMaterialField'
import { useTranslation } from '../../../lib/i18n'
import {
  SAML_SIGN_ALGORITHMS,
  SAML_SIGNATURE_TARGETS,
  type SamlSignFormState,
} from '../../../lib/tools/saml'
import type { SamlSignAlgorithm, SamlSignatureTarget } from '../../../types'
import { Field, INPUT, Pane, TEXTAREA } from './fields'

/**
 * Sign tab.
 *
 * ADDITIVE (#60/#65): the pasted Certificate / Private Key PEM textareas are
 * the DEFAULT and only mandatory path — with the picker untouched the payload
 * sent to `saml:sign` is exactly `{ inline: { certPem, privateKeyPem } }`.
 * `KeyMaterialField` adds ONE optional `keySource` arm and never clears the
 * textareas, so removing the source returns to the pasted PEMs unchanged.
 */
export default function SignForm({
  form,
  patch,
}: {
  form: SamlSignFormState
  patch: (p: Partial<SamlSignFormState>) => void
}) {
  const { t } = useTranslation()
  const usingSource = form.keySource !== null

  return (
    <Pane>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('tools.saml.algorithm')}>
          <select
            className={INPUT}
            value={form.algorithm}
            onChange={(e) => patch({ algorithm: e.target.value as SamlSignAlgorithm })}
          >
            {SAML_SIGN_ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('tools.saml.signatureTarget')}>
          <select
            className={INPUT}
            value={form.signatureTarget}
            onChange={(e) => patch({ signatureTarget: e.target.value as SamlSignatureTarget })}
          >
            {SAML_SIGNATURE_TARGETS.map((s) => (
              <option key={s} value={s}>
                {t(`tools.saml.target.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <textarea
        className={TEXTAREA}
        placeholder={t('tools.saml.certPemPlaceholder')}
        value={form.certPem}
        onChange={(e) => patch({ certPem: e.target.value })}
      />
      <textarea
        className={TEXTAREA}
        placeholder={t('tools.saml.keyPemPlaceholder')}
        value={form.privateKeyPem}
        onChange={(e) => patch({ privateKeyPem: e.target.value })}
      />
      <input
        className={INPUT}
        type="password"
        placeholder={t('tools.saml.passphrase')}
        value={form.passphrase}
        onChange={(e) => patch({ passphrase: e.target.value })}
      />

      <KeyMaterialField
        value={form.keySource}
        label={form.keySourceLabel}
        filter="privateKey"
        hint={t('tools.saml.keystoreHint')}
        onChange={(sel) => {
          // Never touches certPem / privateKeyPem — the default path survives.
          patch({
            keySource: sel ? sel.source : null,
            keySourceLabel: sel ? sel.label : null,
          })
        }}
      />
      {usingSource && (
        <div className="text-[10px]" style={{ color: 'var(--hint)' }}>
          {t('tools.saml.keystoreActive')}
        </div>
      )}
    </Pane>
  )
}
