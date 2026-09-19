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

  test('slider drag, default weight goal, macro preset grid, and enhanced review summary', async ({page}) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('nourish-local');
    });
    await signIn(page, 'coach-flow-tester');
    await page.setViewportSize({width: 1440, height: 900});
    await expect(page.getByRole('heading', {name: 'Set up profile'})).toBeVisible();

    // Fill Step 1: Body
    await page.getByLabel('Date of birth', {exact: true}).fill('1996-03-14');
    await page.getByLabel('Height (cm)').fill('175');
    await page.getByLabel('Starting weight (kg)').fill('80');
    await page.getByLabel('Sex parameter for equation', {exact: true}).selectOption('male');
    await page.getByRole('button', {name: /^Next: Activity/}).click();

    // Fill Step 2: Activity
    await page.getByLabel('Usual activity (approximate)', {exact: true}).selectOption('1.4');
    await page.getByLabel('Known maintenance calories (optional)').fill('2500');
    await page.getByRole('button', {name: /^Next: Goal/}).click();

    // Step 3: Goal
    await page.getByRole('radio', {name: 'Fat loss', exact: true}).check();
    await page.getByRole('button', {name: /^Next: Details/}).click();

    // Verify the circular target-weight slider is present and supports mouse hold-and-drag
    const slider = page.getByRole('slider', {name: 'Target weight (kg)' });
    await expect(slider).toBeVisible();
    const initialRate = await slider.getAttribute('aria-valuenow');
    const box = await slider.boundingBox();
    expect(box).toBeTruthy();

    // Drag from the current-weight endpoint toward the top of the arc.
    await page.mouse.move(box!.x + box!.width * 0.27, box!.y + box!.height * 0.96);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.18, {steps: 5});
    await page.mouse.up();
    const draggedWeight = await slider.getAttribute('aria-valuenow');
    expect(draggedWeight).not.toBe(initialRate);

    // Verify goal tracking defaults to 'weight' and does NOT have 'open' / 'Ongoing phase'
    const phaseModeSelect = page.getByLabel('Track my goal by', {exact: true});
    await expect(phaseModeSelect).toHaveValue('weight');
    const options = await phaseModeSelect.locator('option').allInnerTexts();
    expect(options).toContain('Target weight');
    expect(options).toContain('Duration');
    expect(options).not.toContain('Ongoing phase');

    // Move the dial to approximately 72 kg; the current 80 kg is the default.
    await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.18);
    const selectedWeight=Number(await slider.getAttribute('aria-valuenow'));
    expect(selectedWeight).toBeGreaterThan(70);
    expect(selectedWeight).toBeLessThan(73);

    // Capture Step 3 screenshot
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({path: 'artifacts/coach-step3-goal-dark.png', fullPage: false});

    // Advance through pace to Step 5: Macros
    await page.getByRole('button', {name: /^Next: Pace/}).click();
    const paceSlider=page.getByRole('slider', {name: 'Rate (% bodyweight per week)' });
    await expect(paceSlider).toBeVisible();
    await page.getByRole('button', {name: /^Next: Macros/}).click();

    // Verify macro preset card grid
    const presetGrid = page.locator('.macro-preset-grid');
    await expect(presetGrid).toBeVisible();
    const cards = presetGrid.locator('.macro-preset-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(7);

    const customCard = cards.filter({hasText: /^Custom/});
    const customPreviewBefore = await customCard.locator('.macro-preset-stats').innerText();
    const defaultPreview = await cards.filter({hasText: /^Coach default/}).locator('.macro-preset-stats').innerText();
    expect(customPreviewBefore).not.toBe(defaultPreview);

    // Select "High protein" preset card
    const highProteinCard = cards.filter({hasText: 'High protein'});
    await highProteinCard.click();
    await expect(highProteinCard).toHaveClass(/selected/);
    await expect(highProteinCard).toHaveAttribute('aria-checked', 'true');
    expect(await customCard.locator('.macro-preset-stats').innerText()).toBe(customPreviewBefore);

    // Capture Step 4 screenshot
    await page.screenshot({path: 'artifacts/coach-step4-macros-dark.png', fullPage: false});

    // Advance through Step 5 (Adjust) and Step 6 (Distribution)
    await page.getByRole('button', {name: /^Next: Distribution/}).click();
    await page.getByRole('button', {name: /^Next: Review/}).click();

    // Step 7: Review summary checks
    const reviewSummary = page.locator('.macro-review-summary');
    await expect(reviewSummary).toBeVisible();

    // Key metrics tiles
    const metricTiles = reviewSummary.locator('.summary-metric-tile');
    await expect(metricTiles).toHaveCount(4);
    await expect(metricTiles.nth(0)).toContainText('Fat loss');
    await expect(metricTiles.nth(1)).toContainText(`${selectedWeight} kg`);

    // Macro breakdown bar and chips
    await expect(reviewSummary.locator('.macro-summary-bar')).toBeVisible();
    const macroChips = reviewSummary.locator('.macro-review-chip');
    await expect(macroChips).toHaveCount(3);

    // Daily calorie schedule chips
    const dayChips = reviewSummary.locator('.weekly-day-chip');
    await expect(dayChips).toHaveCount(7);

    // Capture Step 7 review screenshots in both dark and light themes
    await page.screenshot({path: 'artifacts/coach-step7-review-dark.png', fullPage: false});
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.screenshot({path: 'artifacts/coach-step7-review-light.png', fullPage: false});
  });
});
