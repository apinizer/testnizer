/**
 * The env block of an untrusted stdio MCP server as its trust card shows it
 * (issue #180). Trust is recorded for the command AND its env values
 * (`stdioTrustKey`), so the card must show what the user is trusting: a
 * pulled project can keep a familiar `node server.js` and add
 * `NODE_OPTIONS=--require ./evil.js`. Values are shown, except
 * credential-named ones (and URL credentials) which are masked; variables
 * that change what runs or what gets loaded are flagged.
 *
 * Pure TS: main builds the card (Send's loop and the Tools tab's Load tools).
 */
import { HISTORY_MASK, isCredentialHeaderName } from './credential-headers'
import type { AiStdioEnvEntry } from './ai-chat-types'

/** Names that change which program runs or what it loads (upper-cased compare). */
const DANGEROUS_NAMES = new Set([
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'ELECTRON_RUN_AS_NODE',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'PYTHONINSPECT',
  'PERL5OPT',
  'PERL5LIB',
  'PERLLIB',
  'RUBYOPT',
  'RUBYLIB',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'CLASSPATH',
  'BASH_ENV',
  'ENV',
  'SHELLOPTS',
  'PS4',
  'PROMPT_COMMAND',
  'GIT_SSH_COMMAND',
  'GIT_EXEC_PATH',
  'DENO_DIR',
  'BUN_INSTALL',
])

/** Prefixes of loader / runtime-injection families (`LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, …). */
const DANGEROUS_PREFIXES = ['LD_', 'DYLD_', 'NPM_CONFIG_', 'PYTHON']

export function isDangerousEnvName(name: string): boolean {
  const n = name.trim().toUpperCase()
  if (!n) return false
  return DANGEROUS_NAMES.has(n) || DANGEROUS_PREFIXES.some((p) => n.startsWith(p))
}

/** `scheme://user:pass@host` — credentials in a URL value. */
const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/\s@]*:[^/\s@]*@/i

const URL_USERINFO_PART = /^(\s*[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*:[^/\s@]*@/i

export function hasUrlCredentials(value: string): boolean {
  return URL_USERINFO.test(value.trim())
}

/**
 * Longest ordinary value shown on a card (a giant value must not blow up the
 * turn). A DANGEROUS variable is never cut: padding `NODE_OPTIONS` past the
 * cut would hide the `--require` the user is about to trust.
 */
export const STDIO_ENV_VALUE_MAX = 4_000

/**
 * The card rows: every variable with its value; a credential-named value or
 * a URL carrying `user:pass@` is masked — unless the name is dangerous, which
 * is never hidden (the user must see what `NODE_OPTIONS` does).
 */
export function stdioEnvDisplay(env: Record<string, string> | undefined): AiStdioEnvEntry[] {
  const out: AiStdioEnvEntry[] = []
  for (const [name, raw] of Object.entries(env ?? {})) {
    const value = typeof raw === 'string' ? raw : ''
    const dangerous = isDangerousEnvName(name)
    const secret = !dangerous && (isCredentialHeaderName(name) || hasUrlCredentials(value))
    // A dangerous name stays visible; only URL credentials inside it are hidden.
    const visible = dangerous ? value.replace(URL_USERINFO_PART, `$1${HISTORY_MASK}@`) : value
    const shown =
      !dangerous && visible.length > STDIO_ENV_VALUE_MAX
        ? `${visible.slice(0, STDIO_ENV_VALUE_MAX)}… (+${visible.length - STDIO_ENV_VALUE_MAX})`
        : visible
    out.push({
      name,
      value: secret && value ? HISTORY_MASK : shown,
      ...(secret && value ? { masked: true } : {}),
      ...(dangerous ? { dangerous: true } : {}),
    })
  }
  return out
}
