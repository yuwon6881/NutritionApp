import { ensureAcceptedPlan } from './helpers/acceptedPlan';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInApi } from './signIn';

const origin = process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088';
const headers = { Origin: origin, 'X-Nutrition-Request': '1' };
let session: Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/auth/dev-reset', { headers })).ok()).toBeTruthy();
  const response = await signInApi(request, 'test-ai-loading');
  expect(response.ok(), await response.text()).toBeTruthy();
  const state = await (await request.get('/api/state')).json();
  const saved = await request.post('/api/sync', {
    headers,
    data: {
      id: randomUUID(),
      recordId: state.id,
      kind: 'profile',
      expectedRevision: state.profileRevision,
      delete: false,
      data: {
        age: 30,
        dateOfBirth: '1996-03-14',
        heightCm: 170,
        weightKg: 80,
        sex: 'female',
        activity: 1.4,
        goal: 'maintain',
        maintenance: 2500,
        proteinGrams: null,
        resistanceTraining: false,
        pregnancyOrBreastfeeding: false,
        medicalNutrition: false,
        timeZone: 'Asia/Kuala_Lumpur',
        phaseMode: 'open',
        energyAdjustmentPercent: 0,
      },
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await ensureAcceptedPlan(request);
  session = await request.storageState();
});

async function openAnalyze(page: Page) {
  await page.getByRole('button', { name: 'Add entry', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Add', exact: true }).getByRole('button', { name: 'Log food', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Analyze meal', exact: true })).toBeVisible();
}

test('Describe, Photo, and Label loading states stay calm and aligned across widths and themes', async ({ page, context }) => {
  test.setTimeout(120000);
  await context.addCookies(session.cookies);
  await page.goto('/');
  await openAnalyze(page);

  let releaseScan: (() => void) | null = null;
  await page.route('**/api/scans', async route => {
    const input = route.request().postDataJSON();
    await new Promise<void>(resolve => {
      releaseScan = resolve;
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: input.id,
        status: 'complete',
        resultJson: JSON.stringify({
          foods: [{
            name: input.mode === 'label' ? 'Label yoghurt' : input.mode === 'photo' ? 'Photo meal' : 'Coconut rice meal',
            quantity: 100,
            unit: 'g',
            calories: 320,
            protein: 14,
            carbs: 42,
            fat: 10,
            fiber: 3,
            notes: 'Estimated',
          }],
          questions: [],
          explanation: 'Review the quantity and nutrients.',
        }),
      }),
    });
  });

  // 1. Describe loading state: in-place progress line on the textarea, quiet status line, no skeleton card.
  await page.getByLabel('Meal description and portions', { exact: true }).fill('150 g coconut rice, one egg, sambal, cucumber, peanuts');
  await page.getByRole('button', { name: 'Analyze meal', exact: true }).click();
  await expect(page.locator('.ai-description-field.is-analyzing')).toBeVisible();
  await expect(page.locator('.ai-description-progress')).toBeVisible();
  await expect(page.locator('.ai-describe-progress')).toHaveCount(0);
  await expect(page.getByText('Estimating nutrients from your description.', { exact: false })).toBeVisible();

  // Verify the bottom progress bar sits flush with the textarea's bottom edge.
  const alignment = await page.evaluate(() => {
    const textarea = document.querySelector('#ai-meal-description')!.getBoundingClientRect();
    const bar = document.querySelector('.ai-description-progress')!.getBoundingClientRect();
    return { delta: Math.abs(bar.bottom - (textarea.bottom - 1)) };
  });
  expect(alignment.delta).toBeLessThanOrEqual(2);

  for (const width of [390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(260);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: `artifacts/ai-describe-loading-${width}-${theme}.png` });
      }
    }
  }

  // Reduced motion keeps the progress bar static and visible.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.ai-description-progress')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  releaseScan!();
  releaseScan = null;
  await expect(page.getByRole('heading', { name: 'Batch (1 food)' })).toBeVisible();
  await page.getByRole('button', { name: 'Add more food', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();

  // 2. Photo loading state: ScanOverlay + scanning border + unified status copy.
  await page.getByRole('group', { name: 'How would you like to log?', exact: true }).getByRole('button', { name: 'Meal photo', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles('public/icon-512.png');
  await expect.poll(() => page.locator('.ai-photo-preview img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Analyze meal', exact: true }).click();
  await expect(page.locator('.ai-photo-preview.is-scanning')).toBeVisible();
  await expect(page.locator('[data-scan-overlay]')).toBeVisible();
  await expect(page.getByText('Scanning meal…', { exact: true })).toBeVisible();
  await expect(page.getByText('Estimating nutrients from your photo.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(260);
  const photoOverlap = await page.evaluate(() => {
    const status = document.querySelector('.ai-busy-status')!.getBoundingClientRect();
    const actions = document.querySelector('.ai-logging-form .modal-actions')!.getBoundingClientRect();
    return status.bottom - actions.top;
  });
  expect(photoOverlap).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/ai-photo-loading-1440-dark.png' });

  releaseScan!();
  releaseScan = null;
  await expect(page.getByRole('heading', { name: 'Batch (2 foods)' })).toBeVisible();
});
