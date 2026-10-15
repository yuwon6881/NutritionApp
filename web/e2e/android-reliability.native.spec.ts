import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInApi } from './signIn';
import { ensureAcceptedPlan } from './helpers/acceptedPlan';
import { mockNativeDevice } from './helpers/nativeDevice';

test.beforeEach(async ({ page }) => {
  await signInApi(page.request);
  const state = await (await page.request.get('/api/state')).json();
  if (!state.profile) {
    const response = await page.request.post('/api/sync', { headers: {
      Origin: process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088', 'X-Nutrition-Request': '1'
    }, data: { id: randomUUID(), kind: 'profile', recordId: state.id, expectedRevision: 0, delete: false, data: {
      dateOfBirth: '1996-03-14', heightCm: 170, weightKg: 81, sex: 'female', activity: 1.4, goal: 'maintain', maintenance: 2500,
      timeZone: 'Asia/Kuala_Lumpur', phaseMode: 'open', energyAdjustmentPercent: 0
    } } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await ensureAcceptedPlan(page.request);
  await page.route('**/api/notifications/status*', route => route.fulfill({ json: { configured: true, thisDeviceSubscribed: false } }));
  await page.route('**/api/notifications/check-in-reminder', route => route.fulfill({ json: {
    enabled: false, weekday: 1, localTime: '08:00', timeZoneId: 'Asia/Kuala_Lumpur'
  } }));
  await mockNativeDevice(page);
});

for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
  test(`native Settings recovery actions at ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('nutrition-theme', value), theme);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await expect(page.getByText('Blocked', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Android settings', exact: true }).click();
    await page.evaluate(() => {
      const native = (window as unknown as { __nativeDevice: { reminder: { channelDisabled: boolean; soundConfigured: boolean }; listeners: Record<string, (data: unknown) => void> } }).__nativeDevice;
      native.reminder.channelDisabled = false;
      native.reminder.soundConfigured = false;
      native.listeners['App:appStateChange']?.({ isActive: true });
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.getByText('Available but silent', { exact: true })).toBeVisible();
    await page.getByText('Android diagnostics', { exact: true }).click();
    await expect(page.getByRole('term').filter({ hasText: 'APK' })).toBeVisible();
    await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
    const copied = await page.evaluate(() => (window as unknown as { __nativeDevice: { copied: string } }).__nativeDevice.copied);
    expect(copied).toContain('renderer_terminated');
    expect(copied).not.toMatch(/test-alice|token|imageBase64|description/);
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await page.getByRole('button', { name: 'Open release page', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { __nativeDevice: { calls: string[] } }).__nativeDevice.calls)).toContain('NutritionDevice.openApkRelease');
    await page.screenshot({ path: info.outputPath('native-settings.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test('shared image attaches as a captured draft and analysis remains explicit', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/scans', route => { requests++; return route.fulfill({ status: 503, json: { error: 'Fixture analysis is unavailable.' } }); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Food Log', exact: true }).first()).toBeVisible();
  await page.evaluate(() => {
    const native = (window as unknown as { __nativeDevice: { image: unknown; listeners: Record<string, (data: unknown) => void> } }).__nativeDevice;
    native.image = { id: 'a5ade844-b091-4444-b61f-101000000001', mime: 'image/png', size: 68, createdAt: Date.now() };
    native.listeners['NutritionDevice:incomingPhotoReady']?.({});
  });
  await expect(page.getByRole('dialog', { name: 'Attach shared photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Attach photo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Attach shared photo' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Estimate my meal', exact: true })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Estimate my meal', exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(0);
});
