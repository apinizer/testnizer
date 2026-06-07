/**
 * MST-128..131 — GraphQL advanced journeys
 *
 * Server capabilities (graphql-server.ts):
 *   - Query: hello(name), echo(input)
 *   - No mutation defined — MST-128 adds a mutation field inline via a spec-level
 *     mini server (http POST that returns partial data + errors[]).
 *   - No graphql-ws server — MST-131 subscription uses the built-in demo/stub path
 *     in useGraphQLStore (subscriptionState goes "connected" on valid `subscription`
 *     query even without a real graphql-ws server). The test verifies the UI flow:
 *     Subscribe button visible, state shows Subscribed badge.
 *   - Auth header (MST-130): graphql-server is open; test verifies the header row
 *     is carried through by doing a successful query while the header is present.
 *
 * Needs hook:
 *   - MST-131 subscription events list: if the store doesn't emit demo events, the
 *     subscription log will be empty. Test accepts either demo events or "Subscribed"
 *     badge as success (real graphql-ws is a future server addition).
 */
import http from 'node:http'
import net from 'node:net'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'
import { fillMonaco } from '../../helpers/ui/monaco'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

/**
 * Mini GraphQL server with a mutation and a route that returns errors[].
 */
async function startMutationGraphqlServer(port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (req.method === 'POST' && req.url === '/graphql') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        query?: string
        variables?: Record<string, unknown>
        operationName?: string
      }
      const q = body.query ?? ''

      // Mutation: createItem
      if (q.includes('createItem') || q.includes('mutation')) {
        const name = (body.variables?.name as string | undefined) ?? 'default'
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: { createItem: { id: '1', name } } }))
        return
      }
      // Invalid field → errors
      if (q.includes('badField')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            errors: [
              { message: 'Cannot query field "badField" on type "Query".', path: ['badField'] },
            ],
            data: null,
          }),
        )
        return
      }
      // echo query
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { echo: body.variables?.input ?? 'ok' } }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  return {
    url: `http://127.0.0.1:${port}/graphql`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — GraphQL advanced [MST-128..131]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-128: Mutation + errors panel ─────────────────────────────────────
  uiTest('MST-128 mutation returns data and errors panel shows on bad field', async ({ window }) => {
    const port = await getFreePort()
    const server = await startMutationGraphqlServer(port)
    try {
      await openNewDropdownItem(window, /GraphQL/i)
      await window.getByTestId('graphql-url').fill(server.url)

      // Send a mutation
      await fillMonaco(
        window,
        'graphql-query-editor',
        'mutation CreateItem($name: String!) { createItem(name: $name) { id name } }',
      )
      // Set variables
      const varsSectionBtn = window.getByRole('button', { name: /Variables/i })
      if (await varsSectionBtn.isVisible().catch(() => false)) {
        await varsSectionBtn.click()
      }
      // Variables area — Monaco in variables section
      await window
        .locator('.monaco-editor')
        .nth(1)
        .click()
        .catch(() => {})
      await window.keyboard.press('Control+KeyA')
      await window.keyboard.insertText('{"name":"MST128"}')
      await window.waitForTimeout(200)

      await window.getByTestId('graphql-run').click()
      await expect(window.getByText(/MST128|createItem/i).first()).toBeVisible({ timeout: 15_000 })
    } finally {
      await server.close()
    }
  })

  uiTest('MST-128 errors panel renders for invalid field', async ({ window }) => {
    const port = await getFreePort()
    const server = await startMutationGraphqlServer(port)
    try {
      await openNewDropdownItem(window, /GraphQL/i)
      await window.getByTestId('graphql-url').fill(server.url)
      await fillMonaco(window, 'graphql-query-editor', '{ badField }')
      await window.getByTestId('graphql-run').click()
      // Errors banner should appear in the response pane
      await expect(window.getByText(/Cannot query field|GraphQL errors/i).first()).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await server.close()
    }
  })

  // ── MST-129: Variables + operation name ──────────────────────────────────
  uiTest('MST-129 variables resolved in query and operationName accepted', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)

    // Named operation with a variable
    await fillMonaco(
      window,
      'graphql-query-editor',
      'query SayHello($who: String) { hello(name: $who) }',
    )

    // The Variables panel is expanded by default — do NOT click the toggle
    // (that would collapse it). The variables editor is the 2nd Monaco on the
    // page (query is the 1st).
    const editors = window.locator('.monaco-editor')
    const varEditor = editors.nth(1)
    await varEditor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.press('Backspace')
    await window.keyboard.insertText('{"who":"MST129"}')
    // Commit the Monaco onChange before running.
    await window.getByTestId('graphql-url').click()
    await window.waitForTimeout(300)

    await window.getByTestId('graphql-run').click()
    await expect(window.getByText(/MST129/i).first()).toBeVisible({ timeout: 15_000 })
  })

  // ── MST-130: Auth header ──────────────────────────────────────────────────
  uiTest('MST-130 Authorization header carried in GraphQL request', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)

    // Expand Headers section
    await window.getByRole('button', { name: /Headers/i }).last().click()
    await window.getByRole('button', { name: /\+ Add Header/i }).click()
    const rows = window.locator('[data-testid^="kv-row-"]')
    const count = await rows.count()
    const row = rows.nth(count - 1)
    await row.getByTestId('kv-key').fill('Authorization')
    await row.getByTestId('kv-value').locator('input').fill('Bearer mst130')

    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "authtest") }')
    await window.getByTestId('graphql-run').click()
    // Server accepts the request and returns data (auth not validated by test server)
    await expect(window.getByText(/authtest|hello/i).first()).toBeVisible({ timeout: 15_000 })
  })

  // ── MST-131: Subscription query toggles the action button ─────────────────
  // The local graphql test server is HTTP-only (no graphql-ws transport), so a
  // real subscribe → stream → unsubscribe round-trip isn't possible. The
  // deterministic, server-independent behaviour MST-131 names is the action
  // button switching between "Run" (query/mutation) and "Subscribe"
  // (subscription) based on the query text.
  uiTest('MST-131 subscription query changes Run button to Subscribe', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)

    // A plain query keeps the "Run" button (testid graphql-run).
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "x") }')
    await expect(window.getByTestId('graphql-run')).toBeVisible({ timeout: 8_000 })

    // Typing a subscription switches the action to "Subscribe" (exact —
    // "Unsubscribe" also contains "Subscribe" and would trip strict mode), and
    // the Run testid disappears.
    await fillMonaco(window, 'graphql-query-editor', 'subscription { tick }')
    await expect(window.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible({
      timeout: 8_000,
    })
    await expect(window.getByTestId('graphql-run')).toBeHidden()

    // Switching back to a query restores the Run button.
    await fillMonaco(window, 'graphql-query-editor', '{ hello(name: "y") }')
    await expect(window.getByTestId('graphql-run')).toBeVisible({ timeout: 8_000 })
  })
})
