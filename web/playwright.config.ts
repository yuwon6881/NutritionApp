import { defineConfig, devices } from '@playwright/test';
import { testServers } from './e2e/servers';

const signedIn = { storageState: process.env.NUTRITION_TEST_AUTH_PATH ?? 'e2e/.auth/user.json' };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.NUTRITION_TEST_URL || 'http://127.0.0.1:5088',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    {
      name: 'chromium',
      testIgnore: ['auth.setup.ts', '**/*.touch.spec.ts'],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], ...signedIn }
    },
    {
      // Real touch input (hasTouch, coarse pointer, mobile viewport) for gesture, Back, and keyboard contracts.
      name: 'mobile-chromium',
      testMatch: '**/*.touch.spec.ts',
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], ...signedIn }
    }
  ],
  webServer: process.env.NUTRITION_TEST_URL && process.env.NUTRITION_TEST_MANAGED !== '1' ? undefined : testServers,
  reporter: [['list'], ['html', { open: 'never' }]]
});
