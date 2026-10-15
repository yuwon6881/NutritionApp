import { defineConfig } from '@playwright/test';
import { testServers } from './e2e/servers';

export default defineConfig({
  testDir: './e2e', testMatch: '**/*.native.spec.ts', workers: 1, timeout: 90000,
  outputDir: '../artifacts/android-reliability/native-browser-results',
  use: { baseURL: process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088', channel: 'chrome', serviceWorkers: 'block', trace: 'retain-on-failure' },
  webServer: testServers, reporter: 'list'
});
