import { expect, test } from '@playwright/test';
import { seedMobileUser } from './helpers/seed';

test('food log entries waive the 5-second undo hold and flush immediately on backgrounding or toast dismiss', async ({ page, context, request }) => {
  const session = await seedMobileUser(request, 'background-flush-user', []);
  await context.addCookies(session.cookies);

  const syncPayloads: Array<{ name?: string; keepalive?: boolean }> = [];
  await page.route('**/api/sync', async route => {
    const body = route.request().postDataJSON() as { kind?: string; data?: { name?: string } };
    if (body.kind === 'entry') {
      syncPayloads.push({ name: body.data?.name });
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  const logManualFood = async (name: string) => {
    await page.getByRole('button', { name: 'Add entry', exact: true }).first().click();
    await page.getByRole('dialog', { name: 'Add', exact: true }).getByRole('button', { name: 'Log food' }).click();
    await page.getByRole('button', { name: 'Manual entry', exact: true }).click();
    await page.getByLabel('Food name', { exact: true }).fill(name);
    await page.getByLabel('Calories (kcal)', { exact: true }).fill('420');
    await page.getByRole('button', { name: 'Add to batch', exact: true }).click();
    await page.getByRole('button', { name: 'Log 1 food', exact: true }).click();
  };

  // 1. Dismissing the Undo toast immediately flushes without waiting 5 seconds.
  await logManualFood('Toast Dismiss Meal');
  await expect(page.locator('.undo-toast')).toBeVisible();
  expect(syncPayloads).toHaveLength(0);
  await page.getByRole('button', { name: 'Dismiss notice', exact: true }).click();
  await expect.poll(() => syncPayloads.some(p => p.name === 'Toast Dismiss Meal'), { timeout: 1500 }).toBe(true);

  // 2. Hiding/backgrounding the app immediately flushes with keepalive before the 5-second hold expires.
  await logManualFood('Background Hide Meal');
  await expect(page.locator('.undo-toast')).toBeVisible();
  expect(syncPayloads.some(p => p.name === 'Background Hide Meal')).toBe(false);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => syncPayloads.some(p => p.name === 'Background Hide Meal'), { timeout: 1500 }).toBe(true);
  await expect(page.locator('.undo-toast')).toHaveCount(0);

  // Restore visibility and verify Undo while visible still cancels locally without syncing.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await logManualFood('Undone Meal');
  await expect(page.locator('.undo-toast')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Undone.', { exact: true })).toBeVisible();
  expect(syncPayloads.some(p => p.name === 'Undone Meal')).toBe(false);

  // Reload to verify server persistence of the two flushed entries only.
  await page.reload();
  await page.getByRole('button', { name: 'Food Log', exact: true }).click();
  await expect(page.getByText('Toast Dismiss Meal', { exact: true })).toBeVisible();
  await expect(page.getByText('Background Hide Meal', { exact: true })).toBeVisible();
  await expect(page.getByText('Undone Meal', { exact: true })).toHaveCount(0);
});
