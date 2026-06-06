import { expect, type Page } from '@playwright/test'

async function openAuthTab(page: Page, type: string): Promise<void> {
  await page.getByTestId('req-tab-auth').click()
  await page.getByTestId(`auth-type-${type}`).click()
}

export async function setBearerAuth(page: Page, token: string): Promise<void> {
  await openAuthTab(page, 'bearer')
  await page.getByTestId('auth-bearer-token').fill(token)
  await expect(page.getByTestId('auth-bearer-token')).toHaveValue(token)
}

export async function setBasicAuth(page: Page, user: string, pass: string): Promise<void> {
  await openAuthTab(page, 'basic')
  await page.getByTestId('auth-basic-user').fill(user)
  await page.getByTestId('auth-basic-pass').fill(pass)
}

export async function setApiKeyAuth(
  page: Page,
  opts: { key: string; value: string; in: 'header' | 'query' },
): Promise<void> {
  await openAuthTab(page, 'apiKey')
  await page.getByTestId('auth-apikey-key').fill(opts.key)
  await page.getByTestId('auth-apikey-value').fill(opts.value)
  await page
    .getByTestId(opts.in === 'header' ? 'auth-apikey-in-header' : 'auth-apikey-in-query')
    .click()
}

export async function setDigestAuth(page: Page, user: string, pass: string): Promise<void> {
  await openAuthTab(page, 'digest')
  await page.getByPlaceholder('Username').fill(user)
  await page.locator('input[type="password"]').last().fill(pass)
}

/** Configure OAuth2 client_credentials and paste a token (token fetch via main IPC). */
export async function setOAuth2ClientCredentials(
  page: Page,
  opts: { tokenUrl: string; clientId: string; clientSecret: string; token: string },
): Promise<void> {
  await openAuthTab(page, 'oauth2')
  await page.locator('select').first().selectOption('client_credentials')
  await page.getByPlaceholder('https://example.com/oauth/token').fill(opts.tokenUrl)
  await page.getByPlaceholder('your-client-id').fill(opts.clientId)
  await page.getByPlaceholder('your-client-secret').fill(opts.clientSecret)
  await page.getByPlaceholder('Paste token here or use Get New Access Token').fill(opts.token)
}

/** Fetch OAuth2 client_credentials token via main-process request IPC. */
export async function fetchOAuth2Token(
  page: Page,
  opts: { tokenUrl: string; clientId: string; clientSecret: string },
): Promise<string> {
  return page.evaluate(async (o) => {
    const w = window as Window & {
      api?: {
        request?: {
          send: (p: unknown) => Promise<{ success: boolean; data?: { body?: string }; error?: string }>
        }
      }
    }
    const res = await w.api?.request?.send({
      method: 'POST',
      url: o.tokenUrl,
      headers: [{ id: '1', key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true }],
      body: {
        type: 'urlencoded',
        urlEncoded: [
          { id: '1', key: 'grant_type', value: 'client_credentials', enabled: true },
          { id: '2', key: 'client_id', value: o.clientId, enabled: true },
          { id: '3', key: 'client_secret', value: o.clientSecret, enabled: true },
        ],
      },
    })
    if (!res?.success || !res.data?.body) throw new Error(res?.error ?? 'token fetch failed')
    const parsed = JSON.parse(res.data.body) as { access_token?: string }
    if (!parsed.access_token) throw new Error('no access_token in response')
    return parsed.access_token
  }, opts)
}
