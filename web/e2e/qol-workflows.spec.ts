import { expect, test } from '@playwright/test';
import { mockNativeDevice } from './helpers/nativeDevice';
import { seedMobileUser, todayInTestZone } from './helpers/seed';

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test.describe('quality of life workflows', () => {
  test('dashboard shortcuts, remaining macros/fiber, and quick add optional macros & label', async ({ page, request, context }) => {
    const session = await seedMobileUser(request, 'qol-diary', [
      { name: 'Chicken bowl', time: '12:00', calories: 550, protein: 45, carbs: 50, fat: 15, fiber: 8 },
    ]);
    await context.addCookies(session.cookies);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30000 });

    const macrosCard = page.locator('.daily-grid > .macros');
    await expect(macrosCard).toContainText(/\d+\s+g\s+(?:left|over)|On target/);
    await expect(macrosCard.locator('.macros-fiber-row')).toContainText('8 g');

    await page.getByRole('button', { name: 'Add weigh-in', exact: true }).first().click();
    const weightDialog = page.getByRole('dialog');
    await expect(weightDialog.getByRole('heading', { name: /Log weight|Edit weigh-in/ })).toBeVisible();
    await weightDialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Log food from Dashboard', exact: true }).click();
    const foodDialog = page.getByRole('dialog');
    await expect(foodDialog).toBeVisible();
    await foodDialog.getByRole('button', { name: 'Quick add', exact: true }).click();

    await foodDialog.getByLabel(/Calories/).fill('420');
    await foodDialog.getByLabel('Label (optional)').fill('Afternoon shake');
    await foodDialog.getByRole('button', { name: /Macros \(optional\)/ }).click();
    await foodDialog.getByLabel('Protein (g)').fill('30');
    await foodDialog.getByLabel('Carbs (g)').fill('18');
    await foodDialog.getByLabel('Fat (g)').fill('6');
    await foodDialog.getByRole('button', { name: 'Add entry', exact: true }).click();

    await expect(foodDialog).toBeHidden();
    await expect(macrosCard).toContainText(/75\s*\/\s*130 g/);

    await page.getByRole('button', { name: 'Open Food Log from Energy', exact: true }).click();
    await expect(page.locator('.food-day-summary')).toBeVisible();
    await expect(page.getByText('Afternoon shake')).toBeVisible();
    await expect(page.locator('.food-day-nutrients')).toContainText(/\d+\s+g\s+(?:left|over)|On target/);
    await expect(page.locator('.food-day-fiber')).toContainText('8 g');
  });

  test('coach plan step jumps stay outside progress chrome and body copy stays explicit', async ({ page, request, context }) => {
    const session = await seedMobileUser(request, 'qol-coach-body', []);
    await context.addCookies(session.cookies);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Coach', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Coach', exact: true })).toBeVisible();

    await expect(page.getByRole('group', { name: 'Quick edit plan sections' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit plan', exact: true }).click();

    await expect(page.locator('.coach-step-progress button')).toHaveCount(0);
    const jumps = page.locator('.coach-step-jumps button');
    await expect(jumps.first()).toBeVisible();
    await page.locator('.coach-step-jumps').getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Dashboard', exact: true }).last().click();
    await page.getByRole('button', { name: 'Add body record', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Add body record' });
    await dialog.getByLabel('Waist (cm)').fill('82');
    await dialog.getByLabel('Chest (cm)').fill('98');
    await dialog.getByRole('button', { name: 'Save Body record', exact: true }).click();
    await expect(dialog).toBeHidden();

    // Opening another record leaves inputs empty until Copy previous measurements is clicked.
    await page.getByRole('button', { name: 'Add body record', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Add body record' });
    await expect(dialog.getByLabel('Waist (cm)')).toHaveValue('');
    await expect(dialog).toContainText('Previous: 82 cm');
    await dialog.getByRole('button', { name: 'Copy previous measurements', exact: true }).click();
    await expect(dialog.getByLabel('Waist (cm)')).toHaveValue('82');
    await expect(dialog.getByLabel('Chest (cm)')).toHaveValue('98');
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  test('settings data export downloads JSON and CSV ZIP bundles', async ({ page, request, context }) => {
    const session = await seedMobileUser(request, 'qol-export', []);
    await context.addCookies(session.cookies);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30000 });

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download JSON', exact: true }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toBe('nutrition-export.json');
    await expect(page.getByText('Downloaded JSON export.')).toBeVisible();

    const [zipDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download CSV ZIP', exact: true }).click(),
    ]);
    expect(zipDownload.suggestedFilename()).toBe('nutrition-export-csv.zip');
    await expect(page.getByText('Downloaded CSV ZIP export.')).toBeVisible();
  });

  test('ask ai proposals prefill quick add, meal description, and weight draft dialogs', async ({ page, request, context }) => {
    const session = await seedMobileUser(request, 'qol-ai-drafts', []);
    await context.addCookies(session.cookies);
    const currentDate = todayInTestZone();
    let batchCounter = 1;
    let currentAction: { type: string; payload: Record<string, unknown> } = {
      type: 'openQuickAddDraft',
      payload: { date: currentDate, time: '14:30', label: 'Protein latte', calories: 180, protein: 20, carbs: 10, fat: 6 },
    };

    await page.route('**/api/ai/conversation*', route =>
      route.fulfill({
        json: {
          conversationId: 'conv-qol',
          conversationVersion: batchCounter,
          messages: [],
          state: null,
          pendingActionBatches: [{ batchId: `batch-${batchCounter}`, status: 'PendingReview', actions: [currentAction] }],
        },
      }));
    await page.route('**/api/ai/action-batches/*/resolve', route => route.fulfill({ status: 204 }));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();

    await expect(page.getByText('Review quick add')).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/Calories/)).toHaveValue('180');
    await expect(dialog.getByLabel('Label (optional)')).toHaveValue('Protein latte');
    await expect(dialog.getByLabel('Protein (g)')).toHaveValue('20');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    batchCounter = 2;
    currentAction = {
      type: 'openAiFoodDescription',
      payload: { date: currentDate, description: 'Two poached eggs on sourdough' },
    };
    await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();
    await expect(page.getByText('Review meal description')).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Meal description and portions')).toHaveValue('Two poached eggs on sourdough');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    batchCounter = 3;
    currentAction = { type: 'openWeightEntry', payload: { date: currentDate, kg: 79.4 } };
    await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();
    await expect(page.getByText('Review weight entry')).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/Weight \(kg\)/)).toHaveValue('79.4');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('pwa share target handles invalid alerts and pending shared photo attachment', async ({ page, request, context }) => {
    const session = await seedMobileUser(request, 'qol-pwa-share', []);
    await context.addCookies(session.cookies);

    await page.goto('/?pwaShare=too-large');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/larger than the 20 MB limit/)).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page).not.toHaveURL(/pwaShare/);

    await page.evaluate(async base64 => {
      const binary = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0)).buffer;
      const req = indexedDB.open('nutrition-local');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('pwa_incoming', 'readwrite');
        tx.objectStore('pwa_incoming').put(
          { id: 'pwa-share-1', mime: 'image/png', size: binary.byteLength, createdAt: Date.now(), name: 'meal.png', bytes: binary },
          'pending',
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, SAMPLE_PNG_BASE64);

    await page.goto('/?pwaShare=1');
    const shareDialog = page.getByRole('dialog', { name: 'Attach shared photo' });
    await expect(shareDialog).toBeVisible({ timeout: 30000 });
    await shareDialog.getByRole('button', { name: 'Attach photo', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Scan food or label' })).toBeVisible({ timeout: 30000 });
  });

  test('native android bridge receives today widget summary updates', async ({ page, request, context }) => {
    const session = await seedMobileUser(request, 'qol-widget', [
      { name: 'Oats', time: '08:00', calories: 400, protein: 16, carbs: 60, fat: 8 },
    ]);
    await context.addCookies(session.cookies);
    await mockNativeDevice(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __nativeDevice?: { calls: string[] } }).__nativeDevice?.calls ?? []))
      .toContain('NutritionDevice.updateWidgetSummary');
  });
});
