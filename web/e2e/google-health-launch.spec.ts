import {test, expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signIn} from './signIn';

for (const theme of ['light', 'dark']) {
  test(`saved steps appear before a blocked refresh and uploads in ${theme}`, async ({page}, testInfo) => {
    const date = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
    const pending = {enabled: true, permissionGranted: true, state: 'pending', pendingCount: 1, revision: 1, lastSuccessfulSyncAt: null};
    const saved = {status: 'connected', connectedAt: '2026-09-20T10:00:00Z', lastSyncedAt: '2026-09-20T10:00:00Z',
      freshness: 'stale', days: [{date, count: 4321}], weightSync: pending};
    let releaseProvider!: () => void;
    let releaseUploads!: () => void;
    const provider = new Promise<void>(resolve => {releaseProvider = resolve;});
    const uploads = new Promise<void>(resolve => {releaseUploads = resolve;});
    let refreshes = 0;
    await page.route('**/api/integrations/google-health/sync', async route => {
      if (route.request().postDataJSON().force) {
        refreshes++;
        await provider;
        await route.fulfill({json: {...saved, freshness: 'fresh', days: [{date, count: 9876}]}});
      } else await route.fulfill({json: saved});
    });
    await page.route('**/api/integrations/google-health/sync-data', async route => {
      await uploads;
      await route.fulfill({json: {...saved, weightSync: {...pending, state: 'idle', pendingCount: 0}}});
    });
    try {
      await signIn(page, 'test-alice');
      const state = await (await page.request.get('/api/state')).json();
      if (!state.profile) {
        const origin = process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088';
        const response = await page.request.post('/api/sync', {headers: {Origin: origin, 'X-Nutrition-Request': '1'}, data: {
          id: randomUUID(), recordId: state.id, kind: 'profile', expectedRevision: state.profileRevision, delete: false,
          data: {dateOfBirth: '1996-03-14', age: 30, heightCm: 170, weightKg: 81, sex: 'female', activity: 1.4,
            goal: 'maintain', maintenance: 2500, timeZone: 'Asia/Kuala_Lumpur', phaseMode: 'open', energyAdjustmentPercent: 0}
        }});
        expect(response.ok(), await response.text()).toBeTruthy();
      }
      await page.goto('/');
      await page.getByRole('button', {name: 'Dashboard', exact: true}).click();
      const card = page.locator('.steps-panel');
      await expect(card).toContainText('4,321');
      await expect.poll(() => refreshes).toBe(1);
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('online'));
      });
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({width, height: 1000});
        await page.evaluate(value => {document.documentElement.dataset.theme = value;}, theme);
        await expect(card).toContainText('4,321');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        await card.screenshot({path: testInfo.outputPath(`saved-steps-${theme}-${width}.png`)});
      }
      expect(refreshes).toBe(1);
      releaseProvider();
      await expect(card).toContainText('9,876');
      releaseUploads();
    } finally {
      releaseProvider();
      releaseUploads();
    }
  });
}
