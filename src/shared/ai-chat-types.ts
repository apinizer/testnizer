/**
 * AI Chat message model — ONE shape for main and renderer (issues #180, #198,
 * #199). A conversation is an ordered list of turns: a user turn is text; an
 * assistant turn is an ordered list of parts (text, tool calls, tool results,
 * notices) plus the metrics of every LLM call the turn's tool loop made.
 *
 * Main builds the wire transcript from it (`ai-chat-turns.ts`), streams events
 * that the renderer folds into it with the same reducers, and the
 * conversation repo stores it (`ai_conversations.messages_json`). Pure TS:
 * compiled into both bundles.
 */

/** Lifecycle of one tool call the model asked for. */
export type AiToolCallStatus =
  | 'pending-approval'
  | 'approved'
  | 'denied'
  | 'running'
  | 'done'
  | 'error'

export interface AiTextPart {
  type: 'text'
  text: string
}

export interface AiToolCallPart {
  type: 'tool_call'
  /** Provider-issued id (`call_…` / `toolu_…`), or one main generated. */
  id: string
  /** Stable id of the server in the request's Tools config. */
  serverId: string
  /** Server display name. */
  server: string
  /** The MCP tool name (as the server lists it). */
  tool: string
  /** Arguments as the model produced them (JSON text, possibly malformed). Capped. */
  argsJson: string
  status: AiToolCallStatus
}

export interface AiToolResultPart {
  type: 'tool_result'
  callId: string
  /** What the model received for the call — capped at `AI_TOOL_RESULT_MAX_CHARS`. */
  content: string
  isError: boolean
  /** The content was cut at the cap. */
  truncated?: boolean
}

/** Why a notice part was added to a turn. */
export type AiNoticeKind = 'loop-cap' | 'server-error' | 'stdio-untrusted'

export interface AiNoticePart {
  type: 'notice'
  /** Unique within the turn (`loop-cap`, `server-error:<serverId>`, `stdio:<serverId>`). */
  id: string
  kind: AiNoticeKind
  serverId?: string
  server?: string
  message?: string
  /** stdio-untrusted: the command line, credential flag values masked. */
  commandLine?: string
  /** stdio-untrusted: env var NAMES (older turns carry only these). */
  envNames?: string[]
  /**
   * stdio-untrusted: the env the command runs with — trust covers the values
   * too (`NODE_OPTIONS=--require …` changes what runs). Credential-named
   * values are masked; dangerous names are flagged (`stdioEnvDisplay`).
   */
  env?: AiStdioEnvEntry[]
  /** stdio-untrusted: the user's answer. */
  status?: 'pending' | 'trusted' | 'skipped'
}

/** One env var on a stdio trust card (`src/shared/ai-stdio-env.ts`). */
export interface AiStdioEnvEntry {
  name: string
  /** The value as run — or `HISTORY_MASK` when `masked`. */
  value: string
  /** A credential-named value (or URL credentials) hidden from the card. */
  masked?: boolean
  /** The variable can change what the command runs / loads (`NODE_OPTIONS`, `LD_*`, `PATH`…). */
  dangerous?: boolean
}

export type AiAssistantPart = AiTextPart | AiToolCallPart | AiToolResultPart | AiNoticePart

/** One LLM call inside a turn (a turn with tools makes several). */
export interface AiCallMetrics {
  /** HTTP status of the call; null when the request never got a response. */
  status: number | null
  /** Time to the first streamed event (text or tool-call fragment); null when none came. */
  ttfbMs: number | null
  durationMs: number
  /**
   * Prompt tokens. Anthropic: `input_tokens` + cache read + cache creation
   * (the whole prompt, comparable to OpenAI's `prompt_tokens`).
   */
  inputTokens?: number
  outputTokens?: number
  /** Prompt tokens served from the provider's cache (when reported). */
  cachedTokens?: number
  /** Reasoning tokens inside `outputTokens` (when reported). */
  reasoningTokens?: number
  /** The provider reported usage for this call. Missing usage is "not reported", never 0. */
  usageReported: boolean
  error?: string
}

/** A turn's metrics: totals over every call plus the per-call breakdown. */
export interface AiTurnMetrics {
  calls: AiCallMetrics[]
  /** Status of the last call (the one that ended the turn). */
  status: number | null
  /** TTFB of the first call. */
  ttfbMs: number | null
  /** Sum of the calls' durations (tool execution and approval waits excluded). */
  durationMs: number
  /**
   * At least one call reported usage — only then are the token totals set,
   * summed over the calls that reported (issue #198). No call reported →
   * "not reported", never 0.
   */
  usageReported: boolean
  /**
   * Some calls reported usage and some did not: the totals cover only the
   * reporting calls and the UI marks them "partial". Absent otherwise.
   */
  usagePartial?: boolean
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
}

export interface AiUserTurn {
  id: string
  role: 'user'
  /** The prompt as sent — `{{var}}` resolved. */
  content: string
  /**
   * The prompt as typed, `{{var}}` kept — set only when it differs from
   * `content`. Names a conversation, so a `{{secret}}` prompt never puts the
   * secret value into the name (issue #199).
   */
  template?: string
  timestamp: number
}

export interface AiAssistantTurn {
  id: string
  role: 'assistant'
  /** The turn's text parts joined — kept in sync by the reducers (`ai-chat-turns.ts`). */
  content: string
  parts?: AiAssistantPart[]
  metrics?: AiTurnMetrics
  /** The provider stopped at the token limit (issue #189). */
  truncated?: boolean
  /** The turn ended with an error (shown on the turn). */
  error?: string
  timestamp: number
}

export type AiTurn = AiUserTurn | AiAssistantTurn

/** A stored conversation (`ai_conversations` row, decoded). */
export interface AiConversation {
  id: string
  projectId: string | null
  ownerId: string
  name: string
  turns: AiTurn[]
  createdAt: number
  updatedAt: number
}

/** A conversation in the list (no turns). */
export interface AiConversationSummary {
  id: string
  name: string
  turnCount: number
  createdAt: number
  updatedAt: number
}

/** Largest tool result (and tool-call argument text) the model gets and the conversation stores. */
export const AI_TOOL_RESULT_MAX_CHARS = 32_000

/** LLM calls per prompt — the tool loop stops there with a visible note. */
export const AI_TOOL_LOOP_MAX_ROUNDS = 10

/** Owner id of an unsaved tab's conversations; rehomed on the first Save / Save As. */
export function aiTabOwnerId(tabId: string): string {
  return `tab:${tabId}`
}

export function isTabOwnerId(ownerId: string): boolean {
  return ownerId.startsWith('tab:')
}

// ─── Events main → renderer (`aichat:event`) ───────────────────────────────

/**
 * Structured stream events besides the text chunks (`aichat:chunk`):
 *  - `part`: add or replace a non-text part (matched by type + id / callId);
 *  - `call`: one LLM call finished — its metrics.
 * Text keeps flowing through `aichat:chunk` (unchanged since #75).
 */
export type AiChatStreamEvent =
  | { messageId: string; kind: 'part'; part: AiToolCallPart | AiToolResultPart | AiNoticePart }
  | { messageId: string; kind: 'call'; metrics: AiCallMetrics }

/** The user's answer to an approval card. */
export type AiApprovalDecision = 'once' | 'conversation' | 'deny'

/** The user's answer to an untrusted stdio server card. */
export type AiStdioTrustDecision = 'trust' | 'skip'

/** Key of an "Allow this tool for this conversation" grant: server + MCP tool name. */
export function aiToolAllowKey(serverId: string, tool: string): string {
  return `${serverId}::${tool}`
}
