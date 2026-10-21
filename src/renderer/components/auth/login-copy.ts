// ─── Security features for the branding panel ─────────────────
// Issue #240: every line here must be TRUE — checked against
// docs/legal/privacy-policy.md. The app password is a login gate (scrypt hash),
// NOT database encryption; requests and AI Chat go to servers the user picks;
// the update check goes to GitHub; crash telemetry exists only in builds made
// with a SENTRY_DSN. So: "nothing is sent to us", never "nothing leaves".
// Keys are listed literally so tests/renderer/login-copy-i18n.test.tsx sees them
// (the key-coverage test only finds literal t('…') calls).
export const SECURITY_FEATURES = [
  { icon: 'shield', label: 'login.featureOffline', desc: 'login.featureOfflineDesc' },
  { icon: 'lock', label: 'login.featureLocal', desc: 'login.featureLocalDesc' },
  { icon: 'db', label: 'login.featureGit', desc: 'login.featureGitDesc' },
  { icon: 'eye', label: 'login.featureNoTelemetry', desc: 'login.featureNoTelemetryDesc' },
] as const
