import { defineConfig, devices } from '@playwright/test';
import { testServers } from './e2e/servers';

const signedIn = { storageState: 'e2e/.auth/user.json' };

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
      testIgnore: 'auth.setup.ts',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], ...signedIn }
    }
  ],
  webServer: process.env.NUTRITION_TEST_URL ? undefined : testServers,
  reporter: [['list'], ['html', { open: 'never' }]]
});
