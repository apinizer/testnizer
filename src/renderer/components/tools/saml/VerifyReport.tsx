import { useTranslation } from '../../../lib/i18n'
import { classifyFailure } from '../../../lib/tools/saml'
import type { SamlVerifyResult } from '../../../types'

const GREEN = '#1a7a4a'
const GREEN_BG = '#e8f9f1'
const RED = '#cc2200'
const RED_BG = '#fff0f0'

/**
 * The per-check PASS/FAIL breakdown.
 *
 * A validator that says "valid" for a wrapped document is worse than no
 * validator at all — so a rejection is never a bare "invalid": the banner names
 * the CATEGORY (above all XML Signature Wrapping: "the signature does not cover
 * the assertion being trusted") and the check list shows exactly which
 * guarantee failed and why.
 */
export default function VerifyReport({ result }: { result: SamlVerifyResult }) {
  const { t } = useTranslation()
  const failure = result.valid ? null : classifyFailure(result)
  const headlineColor = result.valid ? GREEN : RED

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-xs">
      <div
        className="rounded border px-3 py-2"
        style={{
          borderColor: headlineColor,
          background: result.valid ? GREEN_BG : RED_BG,
          color: headlineColor,
        }}
      >
        <div className="text-sm font-semibold">
          {result.valid ? t('tools.saml.valid') : t('tools.saml.rejected')}
        </div>
        {failure ? (
          <div className="mt-1 font-medium">{t(`tools.saml.fail.${failure.category}`)}</div>
        ) : (
          <div className="mt-1" style={{ color: 'var(--text)' }}>
            {t('tools.saml.validDetail')}
          </div>
        )}
        {failure?.detail ? (
          <div className="mt-1 font-mono text-[11px] break-words" style={{ color: headlineColor }}>
            {failure.detail}
          </div>
        ) : null}
      </div>

      {result.signedElement ? (
        <Row
          label={t('tools.saml.signedElement')}
          value={`${result.signedElement.localName} (ID ${result.signedElement.id})`}
        />
      ) : null}
      {result.signatureMethod ? (
        <Row label={t('tools.saml.signatureMethod')} value={result.signatureMethod} />
      ) : null}
      {result.digestMethod ? (
        <Row label={t('tools.saml.digestMethod')} value={result.digestMethod} />
      ) : null}
      {result.canonicalizationMethod ? (
        <Row label={t('tools.saml.canonicalization')} value={result.canonicalizationMethod} />
      ) : null}
      {result.certInfo?.subject ? (
        <Row label={t('tools.saml.trustAnchorSubject')} value={result.certInfo.subject} />
      ) : null}
      {result.conditions ? (
        <Row
          label={t('tools.saml.conditions')}
          value={[
            result.conditions.notBefore ?? '—',
            '→',
            result.conditions.notOnOrAfter ?? '—',
            result.conditions.audiences.length ? `· ${result.conditions.audiences.join(', ')}` : '',
          ].join(' ')}
        />
      ) : null}
      {result.subject?.nameId ? (
        <Row label={t('tools.saml.subject')} value={result.subject.nameId} />
      ) : null}

      <div className="mt-3 mb-1 font-semibold" style={{ color: 'var(--text)' }}>
        {t('tools.saml.checks')}
      </div>
      <ul className="flex flex-col gap-1">
        {(result.checks ?? []).map((c) => (
          <li
            key={c.name}
            className="flex items-start gap-2 rounded px-2 py-1"
            style={{ background: 'var(--surface)' }}
          >
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: c.ok ? GREEN_BG : RED_BG,
                color: c.ok ? GREEN : RED,
              }}
            >
              {c.ok ? t('tools.saml.pass') : t('tools.saml.fail')}
            </span>
            <span className="min-w-0">
              <span className="font-mono text-[11px]" style={{ color: 'var(--text)' }}>
                {c.name}
              </span>
              {c.detail ? (
                <span className="ml-2 break-words" style={{ color: 'var(--muted)' }}>
                  {c.detail}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <span className="shrink-0" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <span className="min-w-0 break-words font-mono text-[11px]" style={{ color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  )
}
