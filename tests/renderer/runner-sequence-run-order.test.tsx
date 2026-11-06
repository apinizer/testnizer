/**
 * The Run Sequence numbers its rows "in the order requests actually run", but a project run
 * executes the tree's order (folders, then the root's own requests) while the sequence drew
 * the root's requests first. A root "Login" read as step 1 and ran last.
 *
 * Both shapes are built here by the code the tab uses, from a tree in the real tree order.
 */
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import {
  collectEndpointsFromNode,
  collectFolderGroups,
  collectFolderGroupsFromNode,
} from '../../src/renderer/components/runner/runner-rows'
import type { RunnerFolderGroup } from '../../src/renderer/components/runner/RunnerTab'
import { orderTreeLevel } from '../../src/shared/tree-order'
import type { TreeNode } from '../../src/renderer/types'

;(globalThis as unknown as { React: typeof React }).React = React

const noop = () => {}

const request = (id: string): TreeNode =>
  ({ id, type: 'request', label: id, method: 'GET', path: `/${id}` }) as TreeNode

const folder = (id: string, requests: TreeNode[], subFolders: TreeNode[] = []): TreeNode =>
  ({
    id,
    type: 'folder',
    label: id,
    children: orderTreeLevel({ folders: subFolders, endpoints: requests, savedRequests: [] }, false),
  }) as TreeNode

const nested = folder('Tokens', [request('Refresh')])
const auth = folder('Auth', [request('Whoami')], [nested])
const orders = folder('Orders', [request('Create order')])

const project = {
  id: 'project-p1',
  type: 'module',
  label: 'Project',
  children: orderTreeLevel(
    { folders: [auth, orders], endpoints: [request('Login')], savedRequests: [request('Saved')] },
    true,
  ),
} as TreeNode

function drawnRows(groups: RunnerFolderGroup[], tree: TreeNode): string[] {
  render(
    <RunnerSequence
      endpoints={collectEndpointsFromNode(tree)}
      folderGroups={groups}
      onToggle={noop}
      onSelectAll={noop}
      onDeselectAll={noop}
      onReset={noop}
      onSetPhase={noop}
      onSetFolderPhase={noop}
      onToggleFolder={noop}
    />,
  )
  const names = collectEndpointsFromNode(tree).map((ep) => ep.name)
  const list = screen.getByTestId('runner-sequence-list')
  return within(list)
    .getAllByRole('checkbox')
    .map((box) => box.closest('div.border-b')?.textContent ?? '')
    .filter((text) => names.some((name) => text.includes(name)))
    .map((text) => names.find((name) => text.includes(name)) as string)
}

afterEach(cleanup)

describe('the Run Sequence draws the order the run executes', () => {
  it('a project run: folders first, then the requests at the root', () => {
    const runs = collectEndpointsFromNode(project).map((ep) => ep.name)
    expect(runs).toEqual(['Whoami', 'Refresh', 'Create order', 'Login', 'Saved'])
    expect(drawnRows(collectFolderGroups([project]), project)).toEqual(runs)
  })

  it('a folder run: its requests first, then its sub-folders', () => {
    const runs = collectEndpointsFromNode(auth).map((ep) => ep.name)
    const groups: RunnerFolderGroup[] = []
    collectFolderGroupsFromNode(auth, groups)
    expect(runs).toEqual(['Whoami', 'Refresh'])
    expect(drawnRows(groups, auth)).toEqual(runs)
  })

  it('numbers the rows from the top', () => {
    drawnRows(collectFolderGroups([project]), project)
    const first = screen.getByText('Whoami').closest('div.border-b')
    expect(first).toHaveTextContent(/^1/)
    const last = screen.getByText('Saved').closest('div.border-b')
    expect(last).toHaveTextContent(/^5/)
  })
})
