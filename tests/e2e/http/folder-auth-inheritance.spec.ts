import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { localHttpBin } from '../helpers/test-servers'
import { isReachable } from '../helpers/public-endpoints'

/**
 * End-to-end proof of folder → request auth inheritance through the real
 * Collection Runner against the local httpbin-compatible echo server.
 *
 * Sets a Bearer `{{tok}}` on a folder, drops an endpoint inside it whose own
 * auth is `inherit`, and runs it: the echo server's /bearer route reflects the
 * received token, so a 200 + echoed `SECRET123` proves the folder credential
 * was inherited AND the `{{tok}}` variable resolved. A sibling endpoint with an
 * explicit `none` proves the override path (401).
 */

interface RunResult {
  success: boolean
  data?: {
    results: Array<{
      status: number | null
      error?: string
      responseBody?: string
    }>
  }
  error?: string
}

test.beforeAll(async () => {
  const base = localHttpBin()
  const ok = await isReachable(`${base}/get`)
  test.skip(!ok, 'local http echo server is unreachable')
})

test('folder Bearer is inherited by an inherit-auth request; explicit none overrides', async ({
  window,
}) => {
  const base = localHttpBin()

  const out = await window.evaluate(async (BASE: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api
    const unwrap = <T,>(r: { success: boolean; data?: T; error?: string }): T => {
      if (!r?.success) throw new Error(r?.error || 'IPC call failed')
      return r.data as T
    }

    // Workspace (reuse the seeded one if present).
    const wsList = (await api.workspace.list()) as { success: boolean; data?: { id: string }[] }
    const workspaceId =
      wsList.data?.[0]?.id ??
      unwrap<{ id: string }>(await api.workspace.create({ name: 'E2E WS', color: '#000' })).id

    const projectId = unwrap<{ id: string }>(
      await api.project.create({ workspace_id: workspaceId, name: 'Inherit E2E', type: 'http' }),
    ).id

    // Active environment with the token the folder auth references.
    const envId = unwrap<{ id: string }>(
      await api.environment.create({
        workspace_id: workspaceId,
        project_id: projectId,
        name: 'E2E Env',
        is_active: true,
      }),
    ).id
    await api.envVariable.create({
      environment_id: envId,
      key: 'tok',
      value: 'SECRET123',
      initial_value: 'SECRET123',
      enabled: true,
    })
    await api.environment.setActiveForProject(projectId, envId)

    // Folder carrying Bearer {{tok}}.
    const folderId = unwrap<{ id: string }>(
      await api.folder.create({ project_id: projectId, name: 'Secured' }),
    ).id
    await api.folder.update(folderId, {
      auth: JSON.stringify({ type: 'bearer', bearer: { token: '{{tok}}', prefix: 'Bearer' } }),
    })

    // Endpoint A: inherits the folder bearer.
    const inheritEp = unwrap<{ id: string }>(
      await api.endpoint.create({
        project_id: projectId,
        folder_id: folderId,
        name: 'Inherit Bearer',
        protocol: 'http',
        method: 'GET',
        path: '/bearer',
        request_schema: JSON.stringify({
          url: `${BASE}/bearer`,
          method: 'GET',
          auth: { type: 'inherit' },
        }),
      }),
    ).id

    // Endpoint B: explicitly opts out — overrides the inherited bearer.
    const noneEp = unwrap<{ id: string }>(
      await api.endpoint.create({
        project_id: projectId,
        folder_id: folderId,
        name: 'No Auth',
        protocol: 'http',
        method: 'GET',
        path: '/bearer',
        request_schema: JSON.stringify({
          url: `${BASE}/bearer`,
          method: 'GET',
          auth: { type: 'none' },
        }),
      }),
    ).id

    const inheritRun = (await api.runner.execute({
      projectId,
      environmentId: envId,
      endpointIds: [inheritEp],
    })) as RunResult
    const overrideRun = (await api.runner.execute({
      projectId,
      environmentId: envId,
      endpointIds: [noneEp],
    })) as RunResult

    return { inheritRun, overrideRun }
  }, base)

  // Inherited folder bearer → 200, and the echoed token proves {{tok}} resolved.
  expect(out.inheritRun.success).toBe(true)
  const inh = out.inheritRun.data!.results[0]
  expect(inh.error).toBeFalsy()
  expect(inh.status).toBe(200)
  expect(JSON.parse(inh.responseBody ?? '{}').token).toBe('SECRET123')

  // Explicit none overrides the inherited bearer → no Authorization → 401.
  expect(out.overrideRun.success).toBe(true)
  expect(out.overrideRun.data!.results[0].status).toBe(401)
})

test('folder pre-request script runs in the cascade before the request', async ({ window }) => {
  const base = localHttpBin()

  const out = await window.evaluate(async (BASE: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).api
    const unwrap = <T,>(r: { success: boolean; data?: T; error?: string }): T => {
      if (!r?.success) throw new Error(r?.error || 'IPC call failed')
      return r.data as T
    }

    const wsList = (await api.workspace.list()) as { success: boolean; data?: { id: string }[] }
    const workspaceId =
      wsList.data?.[0]?.id ??
      unwrap<{ id: string }>(await api.workspace.create({ name: 'E2E WS', color: '#000' })).id
    const projectId = unwrap<{ id: string }>(
      await api.project.create({ workspace_id: workspaceId, name: 'Cascade E2E', type: 'http' }),
    ).id
    const envId = unwrap<{ id: string }>(
      await api.environment.create({
        workspace_id: workspaceId,
        project_id: projectId,
        name: 'E2E Env',
        is_active: true,
      }),
    ).id
    await api.environment.setActiveForProject(projectId, envId)

    // Folder whose pre-request script writes a variable the request then uses.
    const folderId = unwrap<{ id: string }>(
      await api.folder.create({ project_id: projectId, name: 'Scripted' }),
    ).id
    await api.folder.update(folderId, {
      pre_script: "pm.environment.set('cascadeVal', 'HELLO')",
    })

    const ep = unwrap<{ id: string }>(
      await api.endpoint.create({
        project_id: projectId,
        folder_id: folderId,
        name: 'Uses cascade var',
        protocol: 'http',
        method: 'GET',
        path: '/headers',
        request_schema: JSON.stringify({
          url: `${BASE}/headers`,
          method: 'GET',
          auth: { type: 'none' },
          headers: [{ id: 'h1', key: 'X-Cascade', value: '{{cascadeVal}}', enabled: true }],
        }),
      }),
    ).id

    return (await api.runner.execute({
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as RunResult
  }, base)

  expect(out.success).toBe(true)
  const r = out.data!.results[0]
  expect(r.error).toBeFalsy()
  expect(r.status).toBe(200)
  // The folder pre-request script set cascadeVal=HELLO, which the request
  // header {{cascadeVal}} resolved to and the echo server reflected back.
  expect(r.responseBody ?? '').toContain('HELLO')
})
