import { expect, test } from '@playwright/test';
import { performanceFixture } from '../performance/fixtures';

test('dated cached workouts remain usable while the live peer refresh waits', async ({ page }, info) => {
  const fixture = performanceFixture(7);
  fixture.state.workoutConnected = true;
  const date = fixture.state.end;
  const summary = { id: 'cached-workout', status: 'completed', localDate: date, startedAt: `${date}T08:00:00Z`,
    finishedAt: `${date}T09:00:00Z`, workoutName: 'Cached training', muscleGroups: ['Chest'],
    workingSetCount: 3, externalVolumeKg: null, systemVolumeKg: null, averageRpe: null };
  let release!: () => void;
  const live = new Promise<void>(resolve => { release = resolve; });
  const requests: boolean[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: fixture.state.id, displayName: 'Performance' } });
    if (url.pathname === '/api/bootstrap') return route.fulfill({ json: fixture.state });
    if (url.pathname !== '/api/training/summary') return route.fulfill({ json: { configured: false, connected: false, subscriptions: [], enabled: false } });
    const cached = url.searchParams.get('cacheOnly') === 'true';
    requests.push(cached);
    if (!cached) await live;
    await route.fulfill({ json: { workoutConnected: true, lastSuccessAt: `${date}T09:00:00Z`,
      summaries: [{ ...summary, workoutName: cached ? 'Cached training' : 'Fresh training' }] } });
  });
  try {
    await page.goto('/');
    const card = page.locator('.training-summary');
    await expect(card).toContainText('Cached training');
    await expect(card).toContainText('Last synced');
    await expect(card).toContainText('Refreshing');
    await expect(page.getByRole('button', { name: 'Add entry', exact: true }).last()).toBeEnabled();
    await expect.poll(() => requests).toEqual([true, false]);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card).toContainText('Cached training');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.screenshot({ path: info.outputPath(`cached-training-${width}.png`) });
    }
    release();
    await expect(card).toContainText('Fresh training');
    await expect(card).not.toContainText('Refreshing');
    expect(requests).toEqual([true, false]);
  } finally { release(); }
});

for (const status of [503, 401, 403]) test(status === 503 ? 'an unavailable cached read still reaches the live training summary'
  : `cached training access rejection stops the live request (${status})`, async ({ page }) => {
  const fixture = performanceFixture(7);
  fixture.state.workoutConnected = true;
  const requests: boolean[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { id: fixture.state.id, displayName: 'Performance' } });
    if (url.pathname === '/api/bootstrap') return route.fulfill({ json: fixture.state });
    if (url.pathname !== '/api/training/summary') return route.fulfill({ json: { configured: false, connected: false, enabled: false, subscriptions: [] } });
    const cached = url.searchParams.get('cacheOnly') === 'true';
    requests.push(cached);
    if (cached) return route.fulfill({ status, json: { message: 'Stored summary unavailable' } });
    return route.fulfill({ json: { workoutConnected: true, workoutWarning: null, summaries: [] } });
  });
  await page.goto('/');
  await expect(page.locator('.training-summary')).toContainText('No workouts');
  await expect(page.getByText('Workout sync needs attention', { exact: true })).toHaveCount(status === 503 ? 0 : 1);
  expect(requests).toEqual(status === 503 ? [true, false] : [true]);
});
