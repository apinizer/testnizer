/**
 * TLS Inspector — result pane. Pure move out of `TlsInspectorTool.tsx`.
 *
 * The one rule worth keeping in view here: certificate verdicts render only
 * when the server actually presented a certificate (`resultVisibility`), because
 * the engine fills those fields with placeholders on a transport failure.
 */
import { useTranslation } from '../../../lib/i18n'
import type { TlsCertificateInfo, TlsInspectResult, TlsProbeSuccess } from '../../../types'
import { resultVisibility } from '../../../lib/tools/tls-inspect'
import { Badge, Caption, Meta, AMBER, AMBER_BG, GREEN, GREEN_BG, RED, RED_BG } from './atoms'

export default function ResultPane({
  result,
  error,
  onOpenCert,
  onAddTrusted,
}: {
  result: TlsInspectResult | null
  error: string | null
  onOpenCert: (index: number) => void
  onAddTrusted: (cert: TlsCertificateInfo) => void
}) {
  const { t } = useTranslation()

  /*
   * Narrow ONCE, here. `TlsInspectResult` is a discriminated union: a probe that
   * never handshook has no `hostnameValid`, no `expired`, no `chain` — so the
   * placeholder-as-finding bug (TLS-1/TLS-6) can no longer be written, and the
   * compiler is what enforces it rather than a render guard everyone has to
   * remember. `hasLeaf` stays a runtime question: a handshake can complete
   * against a server that presents no certificate at all (TLS-5).
   */
  const probe = result?.ok ? result : null
  const { handshook, hasLeaf } = result
    ? resultVisibility(result)
    : { handshook: false, hasLeaf: false }

  if (!result && !error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-xs" style={{ color: 'var(--hint)' }}>
          {t('tools.tlsInspect.emptyState')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      {error && (
        <div className="rounded px-3 py-2 text-[11px]" style={{ background: RED_BG, color: RED }}>
          {error}
        </div>
      )}

      {probe && hasLeaf && (
        <>
          <div className="flex flex-wrap gap-2">
            {probe.authorized ? (
              <Badge bg={GREEN_BG} color={GREEN}>
                {t('tools.tlsInspect.trusted')}
              </Badge>
            ) : (
              <Badge bg={AMBER_BG} color={AMBER}>
                {t('tools.tlsInspect.notValidated')}
              </Badge>
            )}
            <Badge
              bg={probe.hostnameValid ? GREEN_BG : RED_BG}
              color={probe.hostnameValid ? GREEN : RED}
            >
              {(probe.hostnameValid
                ? t('tools.tlsInspect.hostnameOkFor')
                : t('tools.tlsInspect.hostnameBadFor')
              ).replace('{name}', probe.servername || probe.host)}
            </Badge>
            <ValidityBadge result={probe} />
            {probe.selfSigned && (
              <Badge bg={AMBER_BG} color={AMBER}>
                {t('tools.tlsInspect.selfSigned')}
              </Badge>
            )}
          </div>

          {!probe.authorized && probe.authorizationError && (
            <div>
              <Caption>{t('tools.tlsInspect.authError')}</Caption>
              <div className="break-all font-mono text-[11px]" style={{ color: RED }}>
                {probe.authorizationError}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meta
              label={t('tools.tlsInspect.expiresIn')}
              value={
                probe.expired
                  ? t('tools.tlsInspect.expiredAgo').replace(
                      '{n}',
                      String(Math.abs(probe.daysToExpiry)),
                    )
                  : t('tools.tlsInspect.inDays').replace('{n}', String(probe.daysToExpiry))
              }
            />
          </div>
        </>
      )}

      {/*
        Transport facts, shown whenever the handshake completed — they are real
        even when the server presents no certificate. Certificate verdicts above
        are gated separately: those placeholders would otherwise be read as
        findings.
      */}
      {probe && handshook && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meta label={t('tools.tlsInspect.protocol')} value={probe.protocol ?? '—'} />
            <Meta
              label={t('tools.tlsInspect.cipher')}
              value={probe.cipher ? probe.cipher.name : '—'}
            />
            <Meta
              label={t('tools.tlsInspect.alpn')}
              value={probe.alpnProtocol === false ? '—' : probe.alpnProtocol}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Caption>{t('tools.tlsInspect.chain')}</Caption>
              <span className="text-[10px]" style={{ color: 'var(--hint)' }}>
                {t('tools.tlsInspect.presentedNote')}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {probe.chain.map((c, i) => (
                <div
                  key={`${c.sha256Fingerprint}-${i}`}
                  className="flex items-center gap-2 rounded border px-2.5 py-1.5"
                  style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
                >
                  <button
                    onClick={() => onOpenCert(i)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span
                      className="truncate text-xs font-medium"
                      style={{ color: 'var(--accentText)' }}
                    >
                      {i === 0 ? `${t('tools.tlsInspect.leaf')} · ` : ''}
                      {c.subjectDN}
                    </span>
                    <span className="truncate text-[10px]" style={{ color: 'var(--muted)' }}>
                      {t('tools.tlsInspect.issuedBy')} {c.issuerDN}
                    </span>
                  </button>
                  <button
                    onClick={() => onAddTrusted(c)}
                    className="shrink-0 rounded border px-2 py-0.5 text-[10px]"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--white)',
                      color: 'var(--accentText)',
                    }}
                    title={t('tools.tlsInspect.addTrusted')}
                  >
                    {t('tools.tlsInspect.addTrusted')}
                  </button>
                </div>
              ))}
              {probe.chain.length === 0 && (
                <span className="text-xs" style={{ color: 'var(--hint)' }}>
                  {t('tools.tlsInspect.noChain')}
                </span>
              )}
            </div>
          </div>

          {/*
            Authoritative values from the RESPONSE, not the local form. The
            connection goes to `host` while the certificate is validated against
            the SNI name, so when they differ the screen has to say which is
            which — a leaf for example.com under a docs.apinizer.com inspection
            otherwise reads as "docs.apinizer.com is example.com".
          */}
          <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
            {probe.host}:{probe.port}
            {probe.servername && probe.servername !== probe.host
              ? ` · SNI: ${probe.servername}`
              : ''}{' '}
            · {t('tools.tlsInspect.presentedFooter')}
          </p>
          {probe.servername && probe.servername !== probe.host && (
            <p className="text-[10px]" style={{ color: AMBER }}>
              {t('tools.tlsInspect.sniDiffers')
                .replace('{host}', probe.host)
                .replace('{sni}', probe.servername)}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ValidityBadge({ result }: { result: TlsProbeSuccess }) {
  const { t } = useTranslation()
  const map = {
    valid: { bg: GREEN_BG, color: GREEN, key: 'tools.tlsInspect.valid' },
    expiring: { bg: AMBER_BG, color: AMBER, key: 'tools.tlsInspect.expiring' },
    expired: { bg: RED_BG, color: RED, key: 'tools.tlsInspect.expired' },
  } as const
  const s = map[result.validityStatus]
  return (
    <Badge bg={s.bg} color={s.color}>
      {t(s.key)}
    </Badge>
  )
}

// ── add-as-trusted → keystore session ────────────────────────────────────────
