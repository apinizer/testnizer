/**
 * The credential-name rule lives in `src/shared/credential-headers.ts` so the
 * shared MCP call module (`src/shared/mcp-call.ts`, used by Send and Run) can
 * mask with the same rule. Main modules keep importing it from here.
 */
export { CREDENTIAL_HEADER_NAME, isCredentialHeaderName } from '../../shared/credential-headers'
