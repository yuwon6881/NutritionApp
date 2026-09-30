import {expect, test} from '@playwright/test';

test('signed-out Nutrition login follows the browser theme, ignores a saved choice, and stays balanced across widths', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nourish-signed-out', '1');
    // A previous account's explicit choice must not colour the signed-out screen.
    localStorage.setItem('nourish-theme', 'light');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Sign in to Nutrition'})).toBeVisible();

  for (const width of [390, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({colorScheme: theme});
      await page.reload();
      await expect(page.getByRole('heading', {name: 'Sign in to Nutrition'})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('button', {name: 'Sign in with Fitness Account'})).toBeVisible();

      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        card: document.querySelector('.auth-card')?.getBoundingClientRect().toJSON(),
        background: getComputedStyle(document.querySelector('.auth-page')!).backgroundColor,
        backgroundImage: getComputedStyle(document.querySelector('.auth-page')!).backgroundImage,
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
      expect(geometry.card?.width).toBeGreaterThan(0);
      expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(geometry.backgroundImage).toContain('radial-gradient');
      await page.screenshot({path: test.info().outputPath(`nutrition-login-${width}-${theme}.png`), fullPage: true, animations: 'disabled'});
    }
  }

  await page.emulateMedia({colorScheme: 'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({colorScheme: 'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Nutrition leaves the Fitness Account theme to the browser and restores the login screen on Back', async ({page}) => {
  await page.emulateMedia({colorScheme: 'dark'});
  await page.addInitScript(() => localStorage.setItem('nourish-signed-out', '1'));
  let releaseRoute!: () => void;
  const routePaused = new Promise<void>(resolve => { releaseRoute = resolve; });
  await page.route('**/api/auth/central/start*', async route => {
    await routePaused;
    await route.fulfill({status: 200, contentType: 'text/html', body: '<main>Fitness Account preview</main>'});
  });

  await page.goto('/');
  const button = page.getByRole('button', {name: 'Sign in with Fitness Account'});
  await expect(button).toBeVisible();
  const request = page.waitForRequest(item => item.url().includes('/api/auth/central/start'));
  const navigation = page.waitForURL('**/api/auth/central/start', {waitUntil: 'domcontentloaded'});
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Starting secure sign-in…');
  await expect(page.getByRole('button', {name: 'Opening Fitness Account…'})).toBeDisabled();
  expect(new URL((await request).url()).searchParams.has('theme')).toBe(false);
  releaseRoute();
  await navigation;
  await expect(page.getByText('Fitness Account preview')).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('button', {name: 'Sign in with Fitness Account'})).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
