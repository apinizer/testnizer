/**
 * curl option table with arity (issue #279). Every option curl documents that
 * takes a value is listed — even the ones Testnizer ignores — so its value is
 * consumed and never mistaken for the URL (the old parser took `-o out.txt`'s
 * `out.txt` as the URL). Kinds:
 *  - a request kind (`header`, `data`, …) → mapped onto the request;
 *  - `ignore`      → no effect on the request (output, progress, retries…), silent;
 *  - `unsupported` → changes what curl sends but has no Testnizer equivalent
 *                    here (proxy, client certificate…) → a warning.
 * A flag missing from the table is `unknown-flag` (warning) and is assumed to
 * take NO value, so the URL that follows it is never swallowed.
 */

export type CurlFlagKind =
  | 'request'
  | 'header'
  | 'data'
  | 'data-ascii'
  | 'data-binary'
  | 'data-raw'
  | 'data-urlencode'
  | 'json'
  | 'form'
  | 'form-string'
  | 'user'
  | 'basic'
  | 'digest'
  | 'ntlm'
  | 'negotiate'
  | 'anyauth'
  | 'cookie'
  | 'user-agent'
  | 'referer'
  | 'get'
  | 'head'
  | 'insecure'
  | 'location'
  | 'max-redirs'
  | 'max-time'
  | 'connect-timeout'
  | 'compressed'
  | 'url'
  | 'oauth2-bearer'
  | 'upload-file'
  | 'next'
  | 'ignore'
  | 'unsupported'

export interface CurlFlagSpec {
  kind: CurlFlagKind
  /** Takes a value (`-H value`, `-Hvalue`, `--header value`, `--header=value`). */
  arg: boolean
}

const v = (kind: CurlFlagKind): CurlFlagSpec => ({ kind, arg: true })
const b = (kind: CurlFlagKind): CurlFlagSpec => ({ kind, arg: false })

/** Short options (case-sensitive). */
export const SHORT_FLAGS: Readonly<Record<string, CurlFlagSpec>> = {
  X: v('request'),
  H: v('header'),
  d: v('data'),
  F: v('form'),
  u: v('user'),
  b: v('cookie'),
  A: v('user-agent'),
  e: v('referer'),
  G: b('get'),
  I: b('head'),
  k: b('insecure'),
  L: b('location'),
  m: v('max-time'),
  T: v('upload-file'),
  x: v('unsupported'), // --proxy
  U: v('unsupported'), // --proxy-user
  E: v('unsupported'), // --cert
  K: v('unsupported'), // --config
  o: v('ignore'),
  D: v('ignore'),
  c: v('ignore'),
  C: v('ignore'),
  w: v('ignore'),
  r: v('ignore'),
  y: v('ignore'),
  Y: v('ignore'),
  z: v('ignore'),
  P: v('ignore'),
  Q: v('ignore'),
  t: v('ignore'),
  ':': b('next'),
  '0': b('ignore'),
  '1': b('ignore'),
  '2': b('ignore'),
  '3': b('ignore'),
  '4': b('ignore'),
  '6': b('ignore'),
  a: b('ignore'),
  B: b('ignore'),
  f: b('ignore'),
  g: b('ignore'),
  h: b('ignore'),
  i: b('ignore'),
  j: b('ignore'),
  J: b('ignore'),
  l: b('ignore'),
  M: b('ignore'),
  n: b('ignore'),
  N: b('ignore'),
  O: b('ignore'),
  p: b('ignore'),
  q: b('ignore'),
  R: b('ignore'),
  s: b('ignore'),
  S: b('ignore'),
  v: b('ignore'),
  V: b('ignore'),
  Z: b('ignore'),
  '#': b('ignore'),
}

const ignoreWithValue = [
  'output',
  'write-out',
  'dump-header',
  'cookie-jar',
  'stderr',
  'trace',
  'trace-ascii',
  'trace-config',
  'retry',
  'retry-delay',
  'retry-max-time',
  'limit-rate',
  'speed-limit',
  'speed-time',
  'max-filesize',
  'continue-at',
  'range',
  'keepalive-time',
  'keepalive-cnt',
  'expect100-timeout',
  'rate',
  'parallel-max',
  'create-file-mode',
  'output-dir',
  'etag-save',
  'etag-compare',
  'time-cond',
  'libcurl',
  'proto',
  'proto-default',
  'proto-redir',
  'alt-svc',
  'hsts',
  'happy-eyeballs-timeout-ms',
  'ftp-port',
  'quote',
  'telnet-option',
  'ftp-account',
  'ftp-alternative-to-user',
  'ftp-method',
  'ftp-ssl-ccc-mode',
  'krb',
  'mail-auth',
  'mail-from',
  'mail-rcpt',
  'tftp-blksize',
  'ip-tos',
  'vlan-priority',
  'netrc-file',
  'url-query',
  'variable',
]

const unsupportedWithValue = [
  'proxy',
  'proxy-user',
  'proxy-header',
  'proxy-cacert',
  'proxy-capath',
  'proxy-cert',
  'proxy-cert-type',
  'proxy-key',
  'proxy-key-type',
  'proxy-pass',
  'proxy-ciphers',
  'proxy-tlsuser',
  'proxy-tlspassword',
  'proxy-service-name',
  'preproxy',
  'socks4',
  'socks4a',
  'socks5',
  'socks5-hostname',
  'socks5-gssapi-service',
  'noproxy',
  'cacert',
  'capath',
  'cert',
  'cert-type',
  'key',
  'key-type',
  'pass',
  'ciphers',
  'tls13-ciphers',
  'curves',
  'tls-max',
  'crlfile',
  'pinnedpubkey',
  'tlsuser',
  'tlspassword',
  'tlsauthtype',
  'resolve',
  'connect-to',
  'interface',
  'local-port',
  'dns-servers',
  'dns-interface',
  'dns-ipv4-addr',
  'dns-ipv6-addr',
  'doh-url',
  'unix-socket',
  'abstract-unix-socket',
  'aws-sigv4',
  'request-target',
  'config',
  'service-name',
  'delegation',
  'login-options',
  'sasl-authzid',
  'hostpubmd5',
  'hostpubsha256',
  'pubkey',
  'engine',
  'random-file',
  'egd-file',
]

const ignoreBoolean = [
  'silent',
  'show-error',
  'verbose',
  'include',
  'show-headers',
  'fail',
  'fail-with-body',
  'fail-early',
  'globoff',
  'http0.9',
  'http1.0',
  'http1.1',
  'http2',
  'http2-prior-knowledge',
  'http3',
  'http3-only',
  'ipv4',
  'ipv6',
  'no-buffer',
  'no-keepalive',
  'no-sessionid',
  'no-alpn',
  'no-npn',
  'no-progress-meter',
  'progress-bar',
  'remote-name',
  'remote-name-all',
  'remote-header-name',
  'remote-time',
  'styled-output',
  'tcp-nodelay',
  'tcp-fastopen',
  'tr-encoding',
  'raw',
  'path-as-is',
  'create-dirs',
  'ssl',
  'ssl-reqd',
  'tlsv1',
  'tlsv1.0',
  'tlsv1.1',
  'tlsv1.2',
  'tlsv1.3',
  'sslv2',
  'sslv3',
  'disable',
  'disable-eprt',
  'disable-epsv',
  'disallow-username-in-url',
  'xattr',
  'post301',
  'post302',
  'post303',
  'ignore-content-length',
  'junk-session-cookies',
  'list-only',
  'crlf',
  'use-ascii',
  'ssl-no-revoke',
  'ssl-allow-beast',
  'ssl-revoke-best-effort',
  'ssl-auto-client-cert',
  'cert-status',
  'false-start',
  'retry-all-errors',
  'retry-connrefused',
  'parallel',
  'parallel-immediate',
  'skip-existing',
  'clobber',
  'metalink',
  'netrc',
  'netrc-optional',
  'manual',
  'help',
  'version',
  'form-escape',
  'compressed-ssh',
  'proxy-insecure',
  'proxy-basic',
  'proxy-digest',
  'proxy-ntlm',
  'proxy-negotiate',
  'proxy-anyauth',
  'proxytunnel',
  'suppress-connect-headers',
  'haproxy-protocol',
  'append',
  'ftp-create-dirs',
  'ftp-pasv',
  'ftp-skip-pasv-ip',
  'ftp-pret',
  'ftp-ssl-control',
  'ignore-content-length',
  'mail-rcpt-allowfails',
  'sasl-ir',
  'tftp-no-options',
  'buffer',
  'keepalive',
  'sessionid',
  'progress-meter',
  'alpn',
  'epsv',
  'eprt',
]

const LONG: Record<string, CurlFlagSpec> = {
  request: v('request'),
  header: v('header'),
  data: v('data'),
  'data-ascii': v('data-ascii'),
  'data-binary': v('data-binary'),
  'data-raw': v('data-raw'),
  'data-urlencode': v('data-urlencode'),
  json: v('json'),
  form: v('form'),
  'form-string': v('form-string'),
  user: v('user'),
  basic: b('basic'),
  digest: b('digest'),
  ntlm: b('ntlm'),
  'ntlm-wb': b('ntlm'),
  negotiate: b('negotiate'),
  anyauth: b('anyauth'),
  cookie: v('cookie'),
  'user-agent': v('user-agent'),
  referer: v('referer'),
  get: b('get'),
  head: b('head'),
  insecure: b('insecure'),
  location: b('location'),
  'location-trusted': b('location'),
  'max-redirs': v('max-redirs'),
  'max-time': v('max-time'),
  'connect-timeout': v('connect-timeout'),
  compressed: b('compressed'),
  url: v('url'),
  'oauth2-bearer': v('oauth2-bearer'),
  'upload-file': v('upload-file'),
  next: b('next'),
}
for (const name of ignoreWithValue) LONG[name] = v('ignore')
for (const name of unsupportedWithValue) LONG[name] = v('unsupported')
for (const name of ignoreBoolean) LONG[name] ??= b('ignore')

export const LONG_FLAGS: Readonly<Record<string, CurlFlagSpec>> = LONG

/** A long option by name (`header`, not `--header`); `undefined` when unknown. */
export function longFlag(name: string): CurlFlagSpec | undefined {
  return Object.prototype.hasOwnProperty.call(LONG, name) ? LONG[name] : undefined
}

/** A short option by its letter; `undefined` when unknown. */
export function shortFlag(ch: string): CurlFlagSpec | undefined {
  return Object.prototype.hasOwnProperty.call(SHORT_FLAGS, ch) ? SHORT_FLAGS[ch] : undefined
}
