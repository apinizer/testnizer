/**
 * ONE rule for "is this HTTP header name credential-bearing?" across every
 * MCP diagnostic that shows or logs headers: the OAuth debugger's step
 * records (`mcp-oauth.engine.ts` `redactHeaders`), the Security Scan's
 * evidence, value scrub, anonymous-probe header set and HTML report
 * (`mcp-security/wire.ts`, `mcp-security/redact.ts`), and the MCP console log
 * (`mcp.handler.ts`).
 *
 * Gateway credentials rarely use the standard names (`Ocp-Apim-Subscription-Key`,
 * `X-Gateway-Key`, `X-Access-Key`, `X-Client-Secret`, … — issue #137), so the
 * rule is deliberately broad: any name containing one of the words below.
 * Over-masking a harmless header costs a `••••` in a report; under-masking
 * leaks a key into an exported file. `WWW-Authenticate` is the server's
 * challenge, not a credential — it stays visible (that is what users debug).
 *
 * Zero imports on purpose: `mcp.handler.ts` must not pull in the MCP SDK
 * through `mcp-oauth.engine.ts` (its tests mock the engine wholesale).
 */
export const CREDENTIAL_HEADER_NAME =
  /auth|token|secret|key|password|passwd|cookie|session|signature/i

export function isCredentialHeaderName(name: string): boolean {
  return name.toLowerCase() !== 'www-authenticate' && CREDENTIAL_HEADER_NAME.test(name)
}
