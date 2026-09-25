import { test as setup } from '@playwright/test';
import { signIn } from './signIn';

setup('sign in once and save the session', async ({ page, request }) => {
  const reset = await request.post('/api/auth/dev-reset', {
    headers: {
      Origin: process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088',
      'X-Nutrition-Request': '1'
    }
  });
  if (!reset.ok()) {
    throw new Error(`Could not reset the isolated end-to-end database: ${await reset.text()}`);
  }
  await signIn(page, 'test-alice');
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
