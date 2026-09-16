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

    // Verify big unit card is NOT rendered
    await expect(page.locator('.coach-unit-bar')).toHaveCount(0);

    // Verify responsiveness across widths and themes with zero horizontal scroll
    for (const width of [390, 768, 1440]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({width, height: 900});
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      }
    }

    await page.setViewportSize({width: 1440, height: 900});

    const heightToggle = page.getByRole('group', {name: 'Height unit'});
    const weightToggle = page.getByRole('group', {name: 'Weight unit'});
    await expect(heightToggle).toBeVisible();
    await expect(weightToggle).toBeVisible();

    // In metric mode: verify height input and date of birth input are aligned horizontally
    const dobInput = page.getByRole('button', {name: 'Choose date of birth'});
    const heightInput = page.getByLabel('Height (cm)');
    const dobBox = await dobInput.boundingBox();
    const heightBox = await heightInput.boundingBox();
    expect(Math.abs(dobBox!.y - heightBox!.y)).toBeLessThanOrEqual(2);

    // Switch Height to ft
    await heightToggle.getByRole('button', {name: /^ft/}).click();
    await expect(page.getByLabel('Height (feet)')).toBeVisible();
    await expect(page.getByLabel('Height (inches)')).toBeVisible();

    // Verify feet input is still in the exact same row aligned with Date of birth
    const feetInput = page.getByLabel('Height (feet)');
    const feetBox = await feetInput.boundingBox();
    expect(Math.abs(dobBox!.y - feetBox!.y)).toBeLessThanOrEqual(2);

    // Verify Starting weight is in the second row, aligned with Sex parameter
    const weightInput = page.getByLabel(/Starting weight/);
    const sexInput = page.getByRole('button', {name: 'Choose sex parameter for equation'});
    const weightBox = await weightInput.boundingBox();
    const sexBox = await sexInput.boundingBox();
    expect(Math.abs(weightBox!.y - sexBox!.y)).toBeLessThanOrEqual(2);

    // Switch Weight to lb
    await weightToggle.getByRole('button', {name: /^lb/}).click();
    await expect(page.getByLabel('Starting weight (lb)')).toBeVisible();

    // Capture imperial state screenshots
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({path: 'artifacts/coach-imperial-dark-1440.png', fullPage: false});

    // Switch back to Metric and capture desktop screenshots for review
    await heightToggle.getByRole('button', {name: /^cm/}).click();
    await weightToggle.getByRole('button', {name: /^kg/}).click();
    await expect(page.getByLabel('Height (cm)')).toBeVisible();
    await expect(page.getByLabel('Starting weight (kg)')).toBeVisible();

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({path: 'artifacts/coach-enhanced-dark-1440.png', fullPage: false});
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({path: 'artifacts/coach-enhanced-light-1440.png', fullPage: false});
  });
});
