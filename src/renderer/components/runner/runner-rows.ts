/**
 * The rows a runner tab builds from the APIs tree. Two shapes of one tree: the flat list is
 * what runs, the groups are what the Run Sequence draws, and they must agree on the order
 * (`tests/renderer/runner-sequence-run-order.test.tsx`).
 */
import type { HttpMethod, TreeNode } from '../../types'
import type { RunnerEndpointItem, RunnerFolderGroup } from './RunnerTab'

export function collectEndpointsFromNode(node: TreeNode): RunnerEndpointItem[] {
  const result: RunnerEndpointItem[] = []
  if ((node.type === 'endpoint' || node.type === 'request') && node.method && node.path) {
    result.push({
      id: node.id,
      name: node.label,
      method: node.method as HttpMethod,
      url: node.path,
      selected: true,
      protocol: node.protocol,
      ...(node.critical ? { critical: true } : {}),
    })
  }
  if (node.children) {
    for (const child of node.children) {
      result.push(...collectEndpointsFromNode(child))
    }
  }
  return result
}

/**
 * Recursively collect folder groups — one group per folder, carrying its parent
 * so the sequence can be rendered as the tree the user organised (issue #90).
 *
 * Folders with no DIRECT requests are collected too, even though they produce
 * no rows themselves: dropping them broke the parent chain, and a child folder
 * whose parent is missing cannot be placed. The sequence prunes branches that
 * hold no requests at all at render time, where it can see the whole subtree.
 */
export function collectFolderGroupsFromNode(
  node: TreeNode,
  groups: RunnerFolderGroup[],
  parentPath?: string,
  parentId: string | null = null,
): void {
  if (!node.children) return
  const fullName = parentPath ? `${parentPath} / ${node.label}` : node.label
  const directEps: RunnerEndpointItem[] = []
  for (const child of node.children) {
    if ((child.type === 'endpoint' || child.type === 'request') && child.method && child.path) {
      directEps.push({
        id: child.id,
        name: child.label,
        method: child.method as HttpMethod,
        url: child.path,
        selected: true,
        protocol: child.protocol,
        ...(child.critical ? { critical: true } : {}),
      })
    }
  }
  groups.push({
    folderId: node.id,
    folderName: fullName,
    label: node.label,
    parentId,
    endpoints: directEps,
    // Only the project node is a 'module'. Its folders come first in the tree, and so in the run.
    ...(node.type === 'module' ? { foldersFirst: true } : {}),
  })
  for (const child of node.children) {
    if (child.type === 'folder' || child.type === 'module') {
      collectFolderGroupsFromNode(child, groups, fullName, node.id)
    }
  }
}

export function collectFolderGroups(nodes: TreeNode[]): RunnerFolderGroup[] {
  const groups: RunnerFolderGroup[] = []
  for (const root of nodes) {
    if (root.type === 'module' || root.type === 'folder') {
      collectFolderGroupsFromNode(root, groups)
    }
  }
  return groups
}
