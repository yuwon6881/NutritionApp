import { test as setup } from '@playwright/test';
import { signIn } from './signIn';

setup('sign in once and save the session', async ({ page }) => {
  await signIn(page, 'test-alice');
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
