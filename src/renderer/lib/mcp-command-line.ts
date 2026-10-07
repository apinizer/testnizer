/**
 * stdio command line <-> `{ command, args }` (issue #139).
 *
 * The MCP tab keeps a stdio server's command in its single URL field
 * (`npx -y @scope/server /some/path`). Config files from Claude Desktop /
 * VS Code / Cursor carry `command` + `args[]` instead, so pasting a config
 * joins them and Connect splits them again.
 *
 * Quoting is deliberately minimal and Windows-friendly: single or double
 * quotes group a token, and a backslash is NEVER an escape character
 * (`C:\Users\me\server.js` must survive untouched). Args that contain a
 * space are quoted on join, so `{ args: ['/My Docs'] }` round-trips.
 */

export interface CommandLine {
  command: string
  args: string[]
}

/** Split a command line into tokens, honouring '…' and "…" grouping. */
export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let quote: '"' | "'" | null = null
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
      continue
    }
    current += ch
    inToken = true
  }
  if (inToken) tokens.push(current)
  return tokens
}

export function parseCommandLine(input: string): CommandLine {
  const [command = '', ...args] = tokenizeCommandLine(input.trim())
  return { command, args }
}

function quoteToken(token: string): string {
  if (token === '') return '""'
  if (!/[\s"']/.test(token)) return token
  return token.includes('"') ? `'${token}'` : `"${token}"`
}

export function joinCommandLine(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(quoteToken).join(' ')
}
