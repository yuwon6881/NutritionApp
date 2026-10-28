import {ensureAcceptedPlan} from './helpers/acceptedPlan';
import {test, expect, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin = process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088';
const headers = {Origin: origin, 'X-Nutrition-Request': '1'};
let session: Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async ({request}) => {
  expect((await request.post('/api/auth/dev-reset', {headers})).ok()).toBeTruthy();
  const response = await signInApi(request, 'test-visual-time');
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
        age: 28,
        dateOfBirth: '1998-05-20',
        heightCm: 175,
        weightKg: 75,
        sex: 'male',
        activity: 1.4,
        goal: 'maintain',
        maintenance: 2600,
        proteinGrams: null,
        resistanceTraining: true,
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

test('capture uplifted time highlighting in Move dialog in both dark and light modes', async ({page, context}) => {
  await context.addCookies(session.cookies);
  // Default to Dark Mode (Midnight Lime)
  await page.emulateMedia({colorScheme: 'dark'});
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('nutrition-theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await expect(page.getByRole('heading', {name: 'Dashboard'})).toBeVisible();

  // Log an entry: Fried egg
  await page.getByRole('button', {name: 'Add entry', exact: true}).first().click();
  await page.getByRole('dialog', {name: 'Add'}).getByRole('button', {name: 'Log food'}).click();
  await page.getByRole('button', {name: 'Manual entry'}).click();
  await page.getByLabel('Food name', {exact: true}).fill('Fried egg');
  await page.getByLabel('Calories (kcal)', {exact: true}).fill('90');
  await page.getByLabel('Meal time', {exact: true}).fill('17:24');
  await page.getByRole('button', {name: 'Add to batch', exact: true}).click();
  await page.getByRole('button', {name: 'Log 1 food', exact: true}).click();
  await page.getByRole('button', {name: 'Food Log', exact: true}).click();

  // Select the item and open Move dialog
  await page.getByRole('button', {name: 'Day options', exact: true}).click();
  await page.getByRole('menuitem', {name: 'Bulk select', exact: true}).click();
  const eggCard = page.locator('.food-time-card').filter({hasText: 'Fried egg'}).first();
  await eggCard.click();
  const bar = page.getByRole('toolbar', {name: 'Bulk selection actions'});
  await bar.getByRole('button', {name: /Move/}).click();

  const moveDialog = page.getByRole('dialog', {name: 'Move Fried egg'});
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole('button', {name: /Date and time/i}).click();

  const customDialog = page.getByRole('dialog', {name: 'Choose date and time'});
  await expect(customDialog).toBeVisible();

  const timeWrapper = customDialog.locator('.time-segmented-wrapper');
  await expect(timeWrapper).toBeVisible();

  // Focus the minute segment (displaying 24) in Dark Mode
  const minuteSegment = customDialog.locator('.time-segment').filter({hasText: '24'});
  await minuteSegment.click();
  await expect(minuteSegment).toHaveClass(/active/);

  // Take screenshot in dark mode (Midnight Lime) - identical screen to user's uploaded image
  await customDialog.screenshot({
    path: 'C:/Users/User/.gemini/antigravity/brain/1d7f8932-698c-4fee-ae94-411c475a4254/uplifted_dark_minute.png',
  });

  // Focus the hour segment (displaying 05) in Dark Mode
  const hourSegment = customDialog.locator('.time-segment').filter({hasText: '05'});
  await hourSegment.click();
  await expect(hourSegment).toHaveClass(/active/);

  await customDialog.screenshot({
    path: 'C:/Users/User/.gemini/antigravity/brain/1d7f8932-698c-4fee-ae94-411c475a4254/uplifted_dark_hour.png',
  });

  // Switch to light theme
  await page.emulateMedia({colorScheme: 'light'});
  await page.evaluate(() => {
    localStorage.setItem('nutrition-theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });

  // Focus minute again in light mode
  await minuteSegment.click();
  await expect(minuteSegment).toHaveClass(/active/);
  await customDialog.screenshot({
    path: 'C:/Users/User/.gemini/antigravity/brain/1d7f8932-698c-4fee-ae94-411c475a4254/uplifted_light_minute.png',
  });
});
