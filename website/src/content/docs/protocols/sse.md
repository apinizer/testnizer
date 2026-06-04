---
title: SSE & AI Chat
description: Monitor Server-Sent Event streams and chat with 14 AI providers — both backed by Testnizer's local SSE engine.
order: 7
section: Protocols
---

Testnizer's SSE editor and AI Chat editor share the same `eventsource`-based
engine running in the Node main process. The renderer receives parsed events
over IPC and never holds an open socket itself.

---

## Server-Sent Events

### Opening an SSE tab

Click **+ New** → **SSE**. The editor opens with a URL field, a headers table,
and an empty event timeline.

### URL and headers

Enter the SSE endpoint URL. Variables resolve in real time:

```
{{apiBaseUrl}}/events/stream?topic={{topicId}}
```

Add HTTP headers in the table below the URL bar. Common headers for SSE
endpoints:

- `Authorization: Bearer {{accessToken}}`
- `Accept: text/event-stream` (added automatically — override only if the
  server requires a different value)
- `Cache-Control: no-cache` (added automatically)

### Connect and Disconnect

Click **Connect** to open the connection. Testnizer sends the HTTP request with
`Accept: text/event-stream` and holds the socket open. The status indicator
shows **Connecting** → **Open**.

Click **Disconnect** to close the connection. The timeline is preserved so you
can scroll through the events received before disconnecting.

### Event timeline

Each parsed event appears in the timeline as it arrives:

| Column | Description |
|---|---|
| **Time** | Timestamp when the event was received (local clock) |
| **Event** | The `event:` field value, or `message` if omitted |
| **ID** | The `id:` field value, if present |
| **Data** | The `data:` payload, truncated to the first 256 characters |

Click any row to expand the full payload in the detail panel on the right. JSON
payloads are automatically pretty-printed.

### SSE field parsing

Testnizer parses all four standard SSE fields:

| Field | What Testnizer does |
|---|---|
| `event:` | Labels the event type; drives the event-type filter |
| `data:` | Accumulates multi-line data blocks and renders them together |
| `id:` | Stores the last event ID; sent automatically on reconnect |
| `retry:` | Updates the reconnect interval displayed in the status bar |

Comment lines (starting with `:`) are shown in the timeline in muted text, not
discarded — useful for debugging keep-alive comments from the server.

### Last-Event-ID and resume

When the connection drops and you click **Reconnect**, Testnizer sets the
`Last-Event-ID` request header to the last `id:` value it received. A
compliant SSE server uses this to replay missed events from the correct
position.

The last known ID is shown in the connection panel so you can inspect or clear
it before reconnecting.

### Filter by event type

Use the **Filter** field above the timeline to show only events of a specific
type. Type `payment.confirmed` and the timeline hides all other event types in
real time. The filter does not drop events — clearing the filter restores the
full timeline.

---

## AI Chat

### Opening an AI Chat tab

Click **+ New** → **AI Chat**. The editor opens with a provider picker, a
model selector, and a chat interface.

### Supported providers

| Provider | Notes |
|---|---|
| **OpenAI** | GPT-4o, o1, o3 and other OpenAI models |
| **Anthropic** | Claude 3.5, 3.7, and current model series |
| **Google** | Gemini 1.5 / 2.0 family |
| **xAI** | Grok models |
| **DeepSeek** | DeepSeek-V3 and reasoning models |
| **Mistral** | Mistral Large, Nemo, Codestral |
| **Groq** | Fast-inference hosting for open models |
| **Perplexity** | Sonar online models |
| **Cerebras** | Wafer-scale inference |
| **Cohere** | Command R+ |
| **Fireworks** | Open-model hosting (Llama, Mixtral, etc.) |
| **DeepInfra** | Open-model hosting |
| **Together** | Together AI open-model hosting |
| **OpenRouter** | Unified router to many providers |

Select a provider from the dropdown. Testnizer loads the model list for that
provider into the **Model** dropdown.

### Custom URL (self-hosted models)

Select **Custom URL** in the provider dropdown to target a self-hosted
OpenAI-compatible endpoint. This works with:

- **vLLM** — `http://localhost:8000/v1`
- **LM Studio** — `http://localhost:1234/v1`
- **Ollama** — `http://localhost:11434/v1`
- **TGI (Text Generation Inference)** — `http://localhost:8080/v1`

Enter the base URL. The model name must be entered manually when using a custom
URL, as there is no remote model list to fetch.

No API key is required for local endpoints — leave the key field blank.

### Model parameters

| Parameter | Description |
|---|---|
| **Model** | The model identifier (e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| **Temperature** | Sampling temperature — 0.0 for deterministic, higher for more varied output |
| **Max tokens** | Maximum number of tokens in the response |
| **Top-p** | Nucleus sampling cutoff (leave at 1.0 unless you have a specific reason to change it) |

Parameters are saved per chat tab. A single project can hold multiple AI Chat
tabs with different providers and model configurations for comparison.

Each AI Chat tab is fully isolated — provider, model, API key, system prompt,
conversation history, and streaming state are all per-tab. Open multiple tabs
to run parallel conversations with different providers without any state
bleeding between them.

### System prompt

The **System** field at the top of the chat accepts a free-text system prompt.
Variables resolve here:

```
You are a helpful assistant for {{projectName}}.
Only answer questions about {{productDomain}}.
```

The system prompt is sent as the first message in every request, regardless of
how many turns the conversation has.

### Multi-turn conversation

Messages accumulate in the conversation window. Each **Send** adds the user
message and the model's reply to the history. The full history is included in
every subsequent request so the model has context.

**History window**: by default, all messages in the current tab are included.
For long conversations, set a **History limit** (number of turns) in the chat
settings to truncate older messages and stay within the model's context window.

### Storing API keys safely

API keys should never be pasted into the chat editor directly. Use environment
variables instead:

1. Open **Environments** for the current project.
2. Add a variable: `apiKey` → `sk-...` (set as the **value**, not
   the initial value, so it is not exported with the project).
3. In the AI Chat editor's **API Key** field, enter `{{apiKey}}`.

The key is stored in the local SQLite database on your machine, encrypted by
the project environment. It never leaves the device.

```
API Key field:  {{openaiApiKey}}
                   ↓
          resolved at send time from the active environment
          → main process sends the request
          → renderer sees only the response stream
```

### Streaming vs. non-streaming

The **Streaming** toggle in the chat toolbar controls how responses are
delivered:

- **Off** (default): Testnizer waits for the full response before rendering
  it. Useful when you need to post-process the response in a test script or
  when the endpoint doesn't support streaming.
- **On**: the model's response appears token by token as the API streams the
  `text/event-stream` response. Latency to first token is lower. While a
  streaming response is in progress, a **Cancel** button appears in the
  toolbar — clicking it stops the stream immediately and preserves whatever
  text was already received.

### Saving and exporting a conversation

Click the **Save** button in the chat toolbar to persist the current
conversation to the project history. Saved conversations appear in the
**History** panel on the left sidebar under the AI Chat tab.

To export:

- **JSON** — the raw messages array in the format `[{role, content}, ...]`,
  suitable for replaying or passing to another system
- **Markdown** — a human-readable transcript with user/assistant labels and
  timestamps

Exports are written to disk via a native save dialog — the renderer initiates
the export via IPC and the main process writes the file.
