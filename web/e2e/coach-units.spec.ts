import {test,expect} from '@playwright/test';
import {signIn} from './signIn';

const headers={Origin:process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088','X-Nutrition-Request':'1'};

test.describe('Coach unit selection', () => {
  test.beforeEach(async ({request}) => {
    await request.post('/api/auth/dev-reset', {headers});
  });

  test('unit system preset and inline toggles switch seamlessly across responsive widths and themes', async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('nourish-local');
    });
    await signIn(page, 'coach-units-tester');
    await expect(page.getByRole('heading', {name: 'Set up profile'})).toBeVisible();

    const unitBar = page.locator('.coach-unit-bar');
    await expect(unitBar).toBeVisible();

    // Verify responsiveness across widths and themes with zero horizontal scroll
    for (const width of [390, 768, 1440]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({width, height: 900});
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      }
    }

    const metricBtn = unitBar.getByRole('button', {name: 'Metric (kg, cm)'});
    const imperialBtn = unitBar.getByRole('button', {name: 'Imperial (lb, ft)'});
    await expect(metricBtn).toBeVisible();
    await expect(imperialBtn).toBeVisible();

    // Switch to Imperial via system preset
    await imperialBtn.click();
    await expect(page.getByLabel('Height (feet)')).toBeVisible();
    await expect(page.getByLabel('Height (inches)')).toBeVisible();
    await expect(page.getByLabel('Starting weight (lb)')).toBeVisible();

    // Switch Height back to cm via inline toggle (mixed units e.g. UK preference)
    const heightToggle = page.getByRole('group', {name: 'Height unit'});
    await heightToggle.getByRole('button', {name: /^cm/}).click();
    await expect(page.getByLabel('Height (cm)')).toBeVisible();
    await expect(page.getByLabel('Starting weight (lb)')).toBeVisible();
    await expect(unitBar.getByRole('button', {name: 'Custom'})).toBeVisible();

    // Switch back to Metric via system preset
    await metricBtn.click();
    await expect(page.getByLabel('Height (cm)')).toBeVisible();
    await expect(page.getByLabel('Starting weight (kg)')).toBeVisible();

    // Switch Weight to lb via inline toggle
    const weightToggle = page.getByRole('group', {name: 'Weight unit'});
    await weightToggle.getByRole('button', {name: /^lb/}).click();
    await expect(page.getByLabel('Starting weight (lb)')).toBeVisible();
    await expect(page.getByLabel('Height (cm)')).toBeVisible();
    await expect(unitBar.getByRole('button', {name: 'Custom'})).toBeVisible();

    // Reset to Metric and capture desktop screenshots for review
    await metricBtn.click();
    await page.setViewportSize({width: 1440, height: 900});
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({path: 'artifacts/coach-enhanced-dark-1440.png', fullPage: false});
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({path: 'artifacts/coach-enhanced-light-1440.png', fullPage: false});
  });
});
