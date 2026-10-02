import { expect, test } from '@playwright/test';
import { performanceFixture } from '../performance/fixtures';

test('the saved-food library loads on logging intent rather than launch', async ({ page }) => {
  const { state } = performanceFixture(7);
  let foodReads = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { id: state.id, displayName: state.displayName } });
    if (path === '/api/bootstrap') return route.fulfill({ json: state });
    if (path === '/api/foods') {
      foodReads++;
      return route.fulfill({ json: { foods: state.foods, revision: state.revision, foodRevision: state.foodRevision } });
    }
    if (path === '/api/diary') return route.fulfill({ json: { from: state.start, to: state.end, revision: state.revision, entries: state.entries, days: state.days } });
    return route.fulfill({ json: { configured: false, connected: false, subscriptions: [], enabled: false } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Food Log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Food Log', exact: true })).toBeVisible();
  expect(foodReads).toBe(0);
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log food', exact: true }).click();
  await expect.poll(() => foodReads).toBe(1);
  await page.getByRole('button', { name: 'Your foods', exact: true }).click();
  await expect(page.getByText('Saved food 0', { exact: true })).toBeVisible();
});
