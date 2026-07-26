import { useTranslation } from '../../../lib/i18n'
import { NAMEID_FORMATS, SAML_BUILD_KINDS, type SamlBuildFormState } from '../../../lib/tools/saml'
import { Check, Field, INPUT, Pane } from './fields'

/** Build tab — the AuthnRequest / Assertion / Response form. */
export default function BuildForm({
  form,
  patch,
}: {
  form: SamlBuildFormState
  patch: (p: Partial<SamlBuildFormState>) => void
}) {
  const { t } = useTranslation()
  const isRequest = form.kind === 'authnRequest'
  const isResponse = form.kind === 'response'

  return (
    <Pane>
      <div className="flex flex-wrap items-center gap-1">
        {SAML_BUILD_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => patch({ kind: k })}
            className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: form.kind === k ? 'var(--accent-light)' : 'transparent',
              color: form.kind === k ? 'var(--accent-text)' : 'var(--muted)',
            }}
          >
            {t(`tools.saml.kind.${k}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t('tools.saml.issuer')}>
          <input
            className={INPUT}
            value={form.issuer}
            onChange={(e) => patch({ issuer: e.target.value })}
          />
        </Field>
        <Field label={t('tools.saml.destination')}>
          <input
            className={INPUT}
            value={form.destination}
            onChange={(e) => patch({ destination: e.target.value })}
          />
        </Field>
        <Field label={t('tools.saml.acsUrl')}>
          <input
            className={INPUT}
            value={form.acsUrl}
            onChange={(e) => patch({ acsUrl: e.target.value })}
          />
        </Field>
        <Field label={t('tools.saml.nameIdFormat')}>
          <select
            className={INPUT}
            value={form.nameIdFormat}
            onChange={(e) => patch({ nameIdFormat: e.target.value })}
          >
            {NAMEID_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.split(':').pop()}
              </option>
            ))}
          </select>
        </Field>
        {!isRequest && (
          <>
            <Field label={t('tools.saml.nameId')}>
              <input
                className={INPUT}
                value={form.nameId}
                onChange={(e) => patch({ nameId: e.target.value })}
              />
            </Field>
            <Field label={t('tools.saml.audience')}>
              <input
                className={INPUT}
                value={form.audience}
                onChange={(e) => patch({ audience: e.target.value })}
              />
            </Field>
            <Field label={t('tools.saml.inResponseTo')}>
              <input
                className={INPUT}
                value={form.inResponseTo}
                onChange={(e) => patch({ inResponseTo: e.target.value })}
              />
            </Field>
            <Field label={t('tools.saml.sessionIndex')}>
              <input
                className={INPUT}
                value={form.sessionIndex}
                onChange={(e) => patch({ sessionIndex: e.target.value })}
              />
            </Field>
            <Field label={t('tools.saml.notBeforeSkew')}>
              <input
                className={INPUT}
                type="number"
                value={form.notBeforeSkewSeconds}
                onChange={(e) => patch({ notBeforeSkewSeconds: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
            <Field label={t('tools.saml.notOnOrAfter')}>
              <input
                className={INPUT}
                type="number"
                value={form.notOnOrAfterSeconds}
                onChange={(e) => patch({ notOnOrAfterSeconds: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
          </>
        )}
      </div>

      {!isRequest && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Check
              label={t('tools.saml.includeAuthnStatement')}
              checked={form.includeAuthnStatement}
              onChange={(v) => patch({ includeAuthnStatement: v })}
            />
            {isResponse && (
              <Check
                label={t('tools.saml.embedAssertion')}
                checked={form.embedEditorAssertion}
                onChange={(v) => patch({ embedEditorAssertion: v })}
              />
            )}
          </div>
          {isResponse && form.embedEditorAssertion && (
            <div className="text-[10px]" style={{ color: 'var(--hint)' }}>
              {t('tools.saml.embedAssertionHint')}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('tools.saml.attributes')}
              </span>
              <button
                type="button"
                onClick={() => patch({ attributes: [...form.attributes, { name: '', value: '' }] })}
                className="cursor-pointer rounded border px-2 py-0.5 text-[11px]"
                style={{ borderColor: 'var(--border)', color: 'var(--accent-text)' }}
              >
                {t('tools.saml.addAttribute')}
              </button>
            </div>
            {form.attributes.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                <input
                  className={INPUT}
                  placeholder={t('tools.saml.attrName')}
                  value={row.name}
                  onChange={(e) => {
                    const next = form.attributes.slice()
                    next[i] = { ...row, name: e.target.value }
                    patch({ attributes: next })
                  }}
                />
                <input
                  className={INPUT}
                  placeholder={t('tools.saml.attrValue')}
                  value={row.value}
                  onChange={(e) => {
                    const next = form.attributes.slice()
                    next[i] = { ...row, value: e.target.value }
                    patch({ attributes: next })
                  }}
                />
                <button
                  type="button"
                  aria-label={t('tools.common.clear')}
                  onClick={() => patch({ attributes: form.attributes.filter((_, j) => j !== i) })}
                  className="cursor-pointer rounded border px-2 text-[11px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Pane>
  )
}
