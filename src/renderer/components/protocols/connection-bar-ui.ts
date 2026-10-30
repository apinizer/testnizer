/**
 * One token set and one wrap rule for the four connection bars — WebSocket,
 * SSE, Socket.IO and MCP (`WsConnectionBar`, `SseConnectionBar`, the
 * Socket.IO bar in `SocketIOEditor`, `mcp/McpConnectionBar`). Class strings
 * only (globals.css tokens, no hex); the status pill is the shared
 * `mcp/McpStatusPill`.
 *
 * Size: every control in a bar — pill, select, URL, buttons — is
 * `CB_HEIGHT`: 2rem, so it grows with the Project Settings font size
 * (26 → 32px between 13 and 16px), never below the 28px pointer target.
 * Text is the base size (`text-sm`); the pill uses `text-xs` (base − 1px).
 * They used to differ: WS / SSE were `py-2` boxes (35px at 13px) while
 * Socket.IO / MCP were `h-8` (26px).
 *
 * Wrap rule (CB_ROW + CB_TARGET):
 *   1. The row wraps (`flex-wrap`); nothing in it is clipped.
 *   2. The status pill and the selectors (SSE method, MCP transport /
 *      protocol) come first and never shrink.
 *   3. The URL and its action buttons are ONE group (`CB_TARGET`) that never
 *      splits: the buttons stay next to the URL and keep their full label
 *      (`whitespace-nowrap`). When less than `CB_TARGET`'s basis is left on
 *      the first line, the whole group moves to its own line, full width.
 *   4. The URL takes the remaining width and never goes below `CB_URL`'s
 *      floor.
 * Extra connection fields (Socket.IO namespace / token) sit on a row of their
 * own under the bar instead of squeezing the URL.
 */

/** Control height of every bar control: 2rem, at least the 28px pointer target. */
export const CB_HEIGHT = 'h-[max(28px,2rem)]'

/** The bar row. */
export const CB_ROW = 'flex flex-wrap items-center gap-2'

/** URL + action buttons: one group that wraps as a unit (rule 3). */
export const CB_TARGET = 'flex min-w-0 flex-[1_1_24rem] items-center gap-2'

const FIELD_LOOK = `${CB_HEIGHT} rounded-md border border-[var(--border)] bg-[var(--white)] px-2.5 font-mono text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]`
const FIELD_DISABLED = 'disabled:cursor-not-allowed disabled:opacity-60'

/** A text field of the bar (namespace, token). Width comes from the caller. */
export const CB_INPUT = `min-w-0 ${FIELD_LOOK} ${FIELD_DISABLED}`

/**
 * The URL field inside a disabled `<fieldset>` (MCP's `{{var}}` input): the
 * fieldset fades the whole field, including the variable-highlight overlay
 * the input itself cannot fade — so no second `disabled:opacity` here.
 */
export const CB_URL_FIELD = `w-full min-w-[10rem] flex-1 ${FIELD_LOOK}`

/**
 * The disabled-able wrapper of a `{{var}}` field (`VariableAutocompleteInput`):
 * `disabled` on the fieldset disables the input and fades its overlay too.
 * The URL's size rule (grows, never below 10rem) sits here, on the flex item.
 */
export const CB_URL_FIELDSET = 'm-0 flex min-w-[10rem] flex-1 border-0 p-0 disabled:opacity-60'

/** The URL / command field: grows, never below 10rem (rule 4). */
export const CB_URL = `${CB_URL_FIELD} ${FIELD_DISABLED}`

/** A selector in front of the URL (method, transport, protocol). No `py-*`: fixed height. */
export const CB_SELECT = `${CB_HEIGHT} shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60`

/** Connect (accent) / Cancel · Disconnect (red) — the primary button. */
export function cbPrimaryButton(busy: boolean): string {
  return `flex ${CB_HEIGHT} shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border-none px-4 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
    busy ? 'bg-[var(--mb-delete-fg)]' : 'bg-[var(--accent)]'
  }`
}

/** A secondary text button next to the primary one (SSE Reconnect). */
export const CB_SECONDARY_BUTTON = `flex ${CB_HEIGHT} shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--border)] bg-transparent px-3 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50`

/** An icon-only button (MCP paste / export config): square, ≥ 28×28, needs an `aria-label`. */
export const CB_ICON_BUTTON = `flex ${CB_HEIGHT} w-[max(28px,2rem)] shrink-0 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-transparent p-0 text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50`

/** The error box under a bar. */
export const CB_ERROR_BOX =
  'break-words rounded-md border border-[var(--mb-delete-br)] bg-[var(--mb-delete-bg)] px-3 py-1.5 text-[var(--red)]'
