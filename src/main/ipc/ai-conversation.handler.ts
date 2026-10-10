import { ipcMain } from 'electron'
import * as repo from '../db/ai-conversation.repo'
import { isTabOwnerId } from '../../shared/ai-chat-types'

/**
 * AI Chat conversation management (issue #199): list / create / rename /
 * delete / load / append, plus the two owner moves of an unsaved tab
 * (rehome on first Save, drop on tab close). Conversations live in the local
 * database only — never in the project file, git or a Duplicate.
 */
export function registerAiConversationHandlers(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      try {
        return { success: true, data: fn(...(args as A)) }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    })
  }

  handle('aichat:conv:list', (ownerId: string) => {
    if (typeof ownerId !== 'string' || !ownerId) throw new Error('ownerId is required')
    return repo.listByOwner(ownerId)
  })

  handle(
    'aichat:conv:create',
    (input: { projectId?: string | null; ownerId: string; name?: string; turns?: unknown }) => {
      if (!input || typeof input.ownerId !== 'string') throw new Error('ownerId is required')
      return repo.create({
        projectId: typeof input.projectId === 'string' ? input.projectId : null,
        ownerId: input.ownerId,
        name: input.name,
        turns: input.turns,
      })
    },
  )

  handle('aichat:conv:load', (id: string) => {
    const conv = repo.get(String(id))
    if (!conv) throw new Error('Conversation not found')
    return conv
  })

  handle('aichat:conv:rename', (id: string, name: string) =>
    repo.rename(String(id), String(name ?? '')),
  )

  handle('aichat:conv:delete', (id: string) => repo.remove(String(id)))

  handle('aichat:conv:append', (id: string, turns: unknown) => {
    const summary = repo.append(String(id), turns)
    if (!summary) throw new Error('Conversation not found')
    return summary
  })

  // Only an UNSAVED tab's conversations move (first Save / Save As). A saved
  // request's conversations stay with it — Save As / Duplicate do not copy.
  handle('aichat:conv:rehome', (fromOwnerId: string, toOwnerId: string) => {
    if (typeof fromOwnerId !== 'string' || !isTabOwnerId(fromOwnerId)) return 0
    if (typeof toOwnerId !== 'string' || !toOwnerId || isTabOwnerId(toOwnerId)) return 0
    return repo.rehome(fromOwnerId, toOwnerId)
  })

  // A closed unsaved tab's conversations go with it.
  handle('aichat:conv:dropTab', (ownerId: string) => {
    if (typeof ownerId !== 'string' || !isTabOwnerId(ownerId)) return 0
    return repo.removeByOwner(ownerId)
  })

  // Startup: unsaved-tab conversations a crash left behind (their tab was not
  // restored) are deleted. Only `tab:` owners — saved requests are untouched.
  handle('aichat:conv:pruneTabs', (liveTabIds: unknown) => {
    if (!Array.isArray(liveTabIds)) throw new Error('liveTabIds must be a list')
    return repo.pruneTabOwners(liveTabIds.filter((x): x is string => typeof x === 'string'))
  })
}
