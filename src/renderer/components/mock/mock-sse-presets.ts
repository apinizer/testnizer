/**
 * "New mock server" presets for SSE mock servers (issue #221, design Ek D
 * §D.3.1) — the SSE twin of `mock-http-presets.ts`, built from the SAME
 * shapes (`HttpPreset`, `res`, `ep`) and created by the SAME orchestrator
 * (`createFromHttpPreset`); the only additions are `server.kind: 'sse'` and
 * each response's `streamConfig`.
 *
 * Bodies are raw SSE text: blank lines end events, every block is rendered
 * when it is written with `{{stream.seq}}` / `{{stream.now}}` in the context
 * (`src/main/mock/stream/`). A looping list or a templated `id:` can never be
 * resumed (Ek C R07), so those presets set `resume: false`. Never write `}}}`
 * in a template: Handlebars reads it as a triple-stash close. The preset test
 * (`tests/main/mock-sse-presets.test.ts`) serves every preset on a real port.
 */
import type { MockSseStreamConfig } from '../../../shared/mock-stream'
import { ep, res, type HttpPreset, type HttpPresetResponse } from './mock-http-presets'

export type MockSsePresetId = 'ticker' | 'replay' | 'notifications' | 'slow'

export const MOCK_SSE_PRESET_IDS: readonly MockSsePresetId[] = [
  'ticker',
  'replay',
  'notifications',
  'slow',
]

/** i18n keys per preset — literal so the key-coverage test can see them. */
export const MOCK_SSE_PRESET_LABEL_KEYS: Record<MockSsePresetId, string> = {
  ticker: 'mockSse.preset.ticker',
  replay: 'mockSse.preset.replay',
  notifications: 'mockSse.preset.notifications',
  slow: 'mockSse.preset.slow',
}

export const MOCK_SSE_PRESET_HINT_KEYS: Record<MockSsePresetId, string> = {
  ticker: 'mockSse.preset.tickerHint',
  replay: 'mockSse.preset.replayHint',
  notifications: 'mockSse.preset.notificationsHint',
  slow: 'mockSse.preset.slowHint',
}

/** Default server names (English on purpose: they become data). */
export const MOCK_SSE_PRESET_NAMES: Record<MockSsePresetId, string> = {
  ticker: 'Ticker SSE',
  replay: 'Replay SSE',
  notifications: 'Notifications SSE',
  slow: 'Slow SSE',
}

/** A looping stream that never ends on its own; dynamic ids → no resume. */
const LOOPING: MockSseStreamConfig = {
  intervalMs: 1000,
  heartbeatMs: 15000,
  loop: true,
  onEnd: 'keep-open',
  resume: false,
}

// `{{stream.seq}}, "at": …` and the quoted time keep `}}` away from the closing `}`.
const TICK_BODY = `id: {{stream.seq}}
event: tick
data: {"n": {{stream.seq}}, "at": "{{stream.now}}"}
`

function sse(
  name: string,
  body: string,
  streamConfig: MockSseStreamConfig,
  over: Partial<HttpPresetResponse> = {},
): HttpPresetResponse {
  return res({ name, bodyType: 'sse', body, streamConfig, ...over })
}

/**
 * The ticker response: what the Ticker preset serves and what the editor's
 * "Add" creates on an SSE server — one definition for both.
 */
export function tickerResponse(): HttpPresetResponse {
  return sse('Ticker', TICK_BODY, { ...LOOPING })
}

const REPLAY_BODY = [1, 2, 3, 4, 5]
  .map(
    (n) =>
      `${n === 1 ? 'retry: 3000\n' : ''}id: ${n}\nevent: message\ndata: {"id": ${n}, "text": "Event ${n} of 5"}\n`,
  )
  .join('\n')

// Named events; `seq` is first in each object so no template ends a JSON value.
const NOTIFICATIONS_BODY = `id: {{stream.seq}}
event: order
data: {"seq": {{stream.seq}}, "orderId": {{$randomInt(1000,9999)}}, "status": "shipped"}

id: {{stream.seq}}
event: message
data: {"seq": {{stream.seq}}, "from": "Ada", "text": "Are we still on for today?"}

id: {{stream.seq}}
event: alert
data: {"seq": {{stream.seq}}, "level": "warning", "text": "Disk usage above 80%"}
`

const UNREAD_BODY = `{
  "unread": {{$randomInt(0,9)}}
}`

export function buildSsePreset(id: MockSsePresetId): HttpPreset {
  switch (id) {
    case 'ticker':
      return {
        server: {
          kind: 'sse',
          description:
            'GET /events sends a "tick" event every second with a growing id. Try it with Open in SSE tab, or new EventSource(url) in a browser.',
        },
        endpoints: [
          ep('GET', '/events', 'A tick every second, until the client leaves', [tickerResponse()]),
        ],
      }
    case 'replay':
      return {
        server: {
          kind: 'sse',
          description:
            'GET /events sends 5 fixed events and closes. A reconnect with Last-Event-ID continues after that id; after the last one it gets 204.',
        },
        endpoints: [
          ep('GET', '/events', 'Events 1–5, then close', [
            sse('Replay', REPLAY_BODY, {
              intervalMs: 500,
              heartbeatMs: 0,
              loop: false,
              onEnd: 'close',
              resume: true,
            }),
          ]),
        ],
      }
    case 'notifications':
      return {
        server: {
          kind: 'sse',
          description:
            'GET /notifications streams order / message / alert events every 2 s; GET /notifications/unread is plain JSON.',
        },
        endpoints: [
          ep('GET', '/notifications', 'Named events with JSON data, every 2 s', [
            sse('Feed', NOTIFICATIONS_BODY, {
              intervalMs: 2000,
              heartbeatMs: 10000,
              loop: true,
              onEnd: 'keep-open',
              resume: false,
            }),
          ]),
          ep('GET', '/notifications/unread', 'Unread count (JSON)', [
            res({ name: 'Unread', body: UNREAD_BODY }),
          ]),
        ],
      }
    case 'slow':
      return {
        server: {
          kind: 'sse',
          description:
            'GET /events answers after 1500 ms, then sends a tick every 10 s with a ": keep-alive" comment every 5 s.',
        },
        endpoints: [
          ep('GET', '/events', 'First event after 1500 ms, then one every 10 s', [
            sse(
              'Slow ticker',
              TICK_BODY,
              { ...LOOPING, intervalMs: 10000, heartbeatMs: 5000 },
              { delayMs: 1500 },
            ),
          ]),
        ],
      }
  }
}
