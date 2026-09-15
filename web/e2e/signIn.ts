import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/// Signs in through central Fitness Account via mock IdP.
export async function signIn(page: Page, username = 'test-alice') {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Sign in with Fitness Account', exact: true });

  await Promise.race([
    page.getByRole('heading', { name: 'Set up profile' }).waitFor({ state: 'visible', timeout: 30000 }),
    page.getByRole('button', { name: 'Food Log' }).waitFor({ state: 'visible', timeout: 30000 }),
    button.waitFor({ state: 'visible', timeout: 30000 })
  ]).catch(() => {});

  if (await button.isVisible().catch(() => false)) {
    await button.click();

    const mockButton = page.getByRole('button', { name: 'Sign in to Fitness Account' });
    await mockButton.waitFor({ state: 'visible', timeout: 30000 });
    if (username) {
      await page.getByLabel('Username').fill(username);
    }
    await mockButton.click();
  }

  await expect(page.locator('.account-name')).toHaveText(username, { timeout: 30000 });
}

export async function signInApi(request: import('@playwright/test').APIRequestContext, username = 'test-alice') {
  const start = await request.get('/api/auth/central/start', { maxRedirects: 0 });
  const authUrl = start.headers()['location'];
  if (!authUrl) return start;
  const parsed = new URL(authUrl);
  parsed.searchParams.set('auto', 'true');
  parsed.searchParams.set('username', username);
  const idp = await request.get(parsed.toString(), { maxRedirects: 0 });
  const callbackUrl = idp.headers()['location'];
  if (!callbackUrl) return idp;
  return await request.get(callbackUrl);
}
