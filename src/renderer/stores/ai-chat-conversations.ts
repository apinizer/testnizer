/**
 * AI Chat conversation management (issue #199) — the renderer side of
 * `aichat:conv:*`. A request keeps a list of conversations in the LOCAL
 * database (never the project file / git / a Duplicate); the AI store holds
 * the one shown. Owner of a tab's conversations: the row it is saved as
 * (suite item / saved request / endpoint — Ctrl+S precedence), or
 * `tab:<tabId>` while unsaved; the first Save / Save As rehomes those.
 *
 * Call-time use of `useAiChatStore` only (the store imports this module).
 */
import { useAiChatStore, liveTabKey, patchAiTab, readAiTab } from './ai-chat.store'
import { useTabsStore } from './tabs.store'
import { stashedProjectTabIds, useWorkspaceStore } from './workspace.store'
import {
  aiTabOwnerId,
  isTabOwnerId,
  type AiAssistantTurn,
  type AiConversation,
  type AiConversationSummary,
  type AiTurn,
  type AiUserTurn,
} from '../../shared/ai-chat-types'
import type { Tab } from '../types'

/** The owner id of a tab's conversations (same precedence as the in-place save). */
export function aiOwnerIdOf(
  tab: Pick<Tab, 'id' | 'testSuiteItemId' | 'savedRequestId' | 'endpointId'>,
): string {
  return tab.testSuiteItemId ?? tab.savedRequestId ?? tab.endpointId ?? aiTabOwnerId(tab.id)
}

/**
 * What a Save / Save As of an AI tab does to its conversations (issue #199):
 *  - `rehome`: the tab was unsaved (`tab:<id>`) — its conversations follow it;
 *  - `fresh`: the tab's owner changes (an endpoint-backed tab saved as a new
 *    request) — the new row starts with no conversation, the old keeps its own;
 *  - `keep`: the owner is unchanged (update in place, or a suite-item tab —
 *    the suite item still wins the owner precedence after Save As).
 * Compares owner ids exactly as `aiOwnerIdOf` derives them.
 */
export function aiSaveAsAction(
  tab: Pick<Tab, 'id' | 'testSuiteItemId' | 'savedRequestId' | 'endpointId'>,
  savedRequestId: string,
): 'rehome' | 'fresh' | 'keep' {
  const prev = aiOwnerIdOf(tab)
  if (isTabOwnerId(prev)) return 'rehome'
  const next = aiOwnerIdOf({ ...tab, savedRequestId })
  return next === prev ? 'keep' : 'fresh'
}

function ownerOfTabKey(tabKey: string): string | null {
  if (tabKey === '__null__') return null
  const tab = useTabsStore.getState().tabs.find((t) => t.id === tabKey)
  return tab ? aiOwnerIdOf(tab) : aiTabOwnerId(tabKey)
}

export function activeProjectIdForAi(): string | undefined {
  try {
    return useWorkspaceStore.getState().activeProjectId ?? undefined
  } catch {
    return undefined
  }
}

const api = () => window.api?.aiChat?.conversations

/** Default name: the first prompt, one line, ≤ 60 chars. */
export function conversationNameFrom(prompt: string): string {
  const line = prompt.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'New conversation'
}

/** One write queue per tab: a fast second answer must not create a second conversation. */
const queues = new Map<string, Promise<void>>()

function enqueue(tabKey: string, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(tabKey) ?? Promise.resolve()).then(job, job).catch(() => {})
  queues.set(tabKey, next)
  return next
}

/** Await every pending conversation write (tests). */
export function flushAiConversationWrites(): Promise<void> {
  return Promise.all([...queues.values()]).then(() => undefined)
}

async function refreshList(tabKey: string, ownerId: string): Promise<void> {
  const res = await api()?.list(ownerId)
  if (res?.success && res.data) {
    const list: AiConversationSummary[] = res.data
    patchAiTab(tabKey, () => ({ conversations: list }))
  }
}

/** Store a finished turn (user + assistant) in the tab's conversation; create it on the first one. */
export function persistFinishedTurn(
  tabKey: string,
  user: AiUserTurn,
  assistant: AiAssistantTurn,
): Promise<void> {
  const ownerId = ownerOfTabKey(tabKey)
  if (!ownerId || !api()) return Promise.resolve()
  return enqueue(tabKey, async () => {
    const st = readAiTab(tabKey)
    if (!st) return
    if (st.conversationId) {
      const res = await api()?.append(st.conversationId, [user, assistant])
      if (res?.success) {
        await refreshList(tabKey, ownerId)
        return
      }
      // Deleted meanwhile — fall through and start a new one.
    }
    // No conversation yet: store EVERYTHING on screen up to this answer — not
    // just this pair. Covers a tab restored from an older release's snapshot
    // (which held the turns) and an earlier create that failed.
    const idx = st.messages.findIndex((m) => m.id === assistant.id)
    const turns = idx >= 0 ? st.messages.slice(0, idx + 1) : [user, assistant]
    await createWith(tabKey, ownerId, turns)
  })
}

async function createWith(tabKey: string, ownerId: string, turns: AiTurn[]): Promise<void> {
  const firstUser = turns.find((t) => t.role === 'user')
  const created = await api()?.create({
    projectId: activeProjectIdForAi() ?? null,
    ownerId,
    // The prompt as typed (`{{var}}` kept): the resolved one may carry a
    // secret value (issue #199). main scrubs the name again on write.
    name: conversationNameFrom(
      firstUser?.role === 'user' ? (firstUser.template ?? firstUser.content) : '',
    ),
    turns,
  })
  if (created?.success && created.data) {
    const conv: AiConversation = created.data
    patchAiTab(tabKey, () => ({ conversationId: conv.id, conversationName: conv.name }))
    await refreshList(tabKey, ownerId)
  }
}

/**
 * Bring the live tab's conversations in from the database once per tab and
 * session (first open, or after a restart — the snapshot carries only the id).
 */
export async function ensureAiConversationsLoaded(): Promise<void> {
  const s = useAiChatStore.getState()
  if (s.conversationLoaded || s.streaming) return
  const tabKey = liveTabKey(s)
  const ownerId = ownerOfTabKey(tabKey)
  if (!ownerId || !api()) return
  patchAiTab(tabKey, () => ({ conversationLoaded: true }))
  const res = await api()?.list(ownerId)
  const list: AiConversationSummary[] = res?.success && res.data ? res.data : []
  const current = readAiTab(tabKey)
  if (!current) return
  patchAiTab(tabKey, () => ({ conversations: list }))
  // Turns on screen with no conversation: a tab restored from an older
  // release's snapshot (it kept the conversation in localStorage). Store them
  // now so they survive — the snapshot no longer carries them.
  if (current.messages.length > 0 && !current.conversationId) {
    if (!current.streaming) {
      const turns = current.messages
      await enqueue(tabKey, async () => {
        if (readAiTab(tabKey)?.conversationId) return
        await createWith(tabKey, ownerId, turns)
      })
    }
    return
  }
  const target = current.conversationId
    ? (list.find((c) => c.id === current.conversationId)?.id ?? null)
    : (list[0]?.id ?? null)
  if (!target) {
    patchAiTab(tabKey, () => ({ conversationId: null, conversationName: null, messages: [] }))
    return
  }
  await loadInto(tabKey, target)
}

async function loadInto(tabKey: string, id: string): Promise<void> {
  const res = await api()?.load(id)
  if (!res?.success || !res.data) return
  const conv: AiConversation = res.data
  patchAiTab(tabKey, () => ({
    conversationId: conv.id,
    conversationName: conv.name,
    messages: conv.turns,
    errorMessage: null,
    allowedTools: [],
  }))
}

/** Show another conversation of this request. */
export async function switchAiConversation(id: string): Promise<void> {
  const s = useAiChatStore.getState()
  if (s.streaming || s.conversationId === id) return
  await loadInto(liveTabKey(s), id)
}

/** Start a new conversation (stored when the first answer arrives). */
export function newAiConversation(): void {
  useAiChatStore.getState().clearConversation()
}

export async function renameAiConversation(id: string, name: string): Promise<void> {
  const s = useAiChatStore.getState()
  const tabKey = liveTabKey(s)
  const ownerId = ownerOfTabKey(tabKey)
  const res = await api()?.rename(id, name)
  if (!res?.success || !ownerId) return
  await refreshList(tabKey, ownerId)
  if (readAiTab(tabKey)?.conversationId === id) {
    // Show the name main stored (scrubbed), not the typed one (issue #199).
    const stored = readAiTab(tabKey)?.conversations.find((c) => c.id === id)?.name
    patchAiTab(tabKey, () => ({
      conversationName: stored ?? (name.replace(/\s+/g, ' ').trim() || null),
    }))
  }
}

export async function deleteAiConversation(id: string): Promise<void> {
  const s = useAiChatStore.getState()
  if (s.streaming && s.conversationId === id) return
  const tabKey = liveTabKey(s)
  const ownerId = ownerOfTabKey(tabKey)
  const res = await api()?.remove(id)
  if (!res?.success || !ownerId) return
  if (readAiTab(tabKey)?.conversationId === id) {
    patchAiTab(tabKey, () => ({
      conversationId: null,
      conversationName: null,
      messages: [],
      errorMessage: null,
      allowedTools: [],
    }))
  }
  await refreshList(tabKey, ownerId)
}

/**
 * First Save / Save As of an unsaved tab: its conversations move to the new
 * row (main refuses anything but a `tab:` owner — a saved request's
 * conversations are never copied or moved).
 */
export async function rehomeAiConversations(tabId: string, newOwnerId: string): Promise<void> {
  if (!api()) return
  await enqueue(tabId, async () => {
    await api()?.rehome(aiTabOwnerId(tabId), newOwnerId)
  })
  if (readAiTab(tabId)) await refreshList(tabId, newOwnerId)
}

let prunedThisSession = false

/**
 * Once per session, at startup: delete the conversations of unsaved tabs that
 * were not restored (the app crashed or was killed before their tab closed —
 * `dropTabConversations` never ran). Main touches only `tab:` owners.
 */
export function pruneOrphanTabConversations(): void {
  if (prunedThisSession) return
  prunedThisSession = true
  void api()
    ?.pruneTabs?.(liveTabIdsForPrune())
    ?.catch?.(() => {})
}

/**
 * Every tab that may still own `tab:` conversations: the open tabs, the tabs
 * stashed for OTHER projects (per-project tab sets, issue #1) and every tab
 * the AI store still holds state for. Over-keeping costs a few rows;
 * under-keeping deletes a live tab's conversation.
 */
export function liveTabIdsForPrune(): string[] {
  const ids = new Set<string>(useTabsStore.getState().tabs.map((t) => t.id))
  for (const id of stashedProjectTabIds()) ids.add(id)
  const ai = useAiChatStore.getState()
  for (const key of ai._tabStates?.keys() ?? []) if (key !== '__null__') ids.add(key)
  if (ai._currentTabId) ids.add(ai._currentTabId)
  return [...ids]
}

/** A closed unsaved tab's conversations are deleted with it. */
export function dropTabConversations(tabId: string): void {
  void enqueue(tabId, async () => {
    await api()?.dropTab(aiTabOwnerId(tabId))
  }).finally(() => queues.delete(tabId))
}

/**
 * Save As of an AI tab that already had a row: the tab now shows the NEW row,
 * whose conversation list starts empty — the original request keeps its
 * conversations (Save As, like Duplicate, does not copy them). Without this
 * the next answer would append to the original request's conversation.
 */
export function startFreshForNewRow(): void {
  const s = useAiChatStore.getState()
  patchAiTab(liveTabKey(s), () => ({
    conversationId: null,
    conversationName: null,
    conversations: [],
    messages: [],
    errorMessage: null,
    allowedTools: [],
    conversationLoaded: false,
  }))
}
