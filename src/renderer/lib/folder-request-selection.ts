import type { TreeNode } from '../types'

/** True for nodes that represent a runnable request (saved request or imported endpoint). */
export function isRequestNode(node: TreeNode): boolean {
  return node.type === 'endpoint' || node.type === 'request'
}

/**
 * Recursively gather every request/endpoint id under a node — including the
 * node itself when it is a request — in tree (depth-first) order. Operates on
 * the in-memory tree so no "list endpoints recursively" IPC is needed (UX 6).
 *
 * Shared by TreeView's folder→suite / folder→mock flows and the request
 * selection modal (issue #102), so "which requests live under this folder"
 * has one answer everywhere.
 */
export function collectRequestIds(node: TreeNode): string[] {
  const ids: string[] = []
  const walk = (n: TreeNode): void => {
    if (isRequestNode(n)) ids.push(n.id)
    if (n.children) for (const c of n.children) walk(c)
  }
  walk(node)
  return ids
}
