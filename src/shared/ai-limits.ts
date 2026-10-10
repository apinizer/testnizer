/**
 * AI Chat generation-setting limits (issue #189) — ONE source for main and
 * renderer. Main checks every IPC payload against these (`ai-chat.handler.ts`);
 * the renderer field rejects the same values with its inline validation
 * (`ai-chat-config.ts`), so a value main would not send is never accepted.
 */

/** Highest `max_tokens` accepted. */
export const AI_MAX_TOKENS_CAP = 200_000
