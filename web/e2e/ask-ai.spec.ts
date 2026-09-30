import { test, expect } from '@playwright/test';
import { seedMobileUser } from './helpers/seed';

const conversationId = '11111111-1111-1111-1111-111111111111';
const batchId = '22222222-2222-2222-2222-222222222222';
const snapshot = { conversationId, conversationVersion: 1, state: null,
  messages: [{ role: 'user', content: 'My previous question' }, { role: 'assistant', content: 'Your saved answer.' }],
  pendingActionBatches: [] };
let session: Awaited<ReturnType<typeof seedMobileUser>>;
test.beforeAll(async ({ request }) => { session = await seedMobileUser(request, 'ask-ai-review', []); });

for (const width of [320, 390, 640, 768, 1024, 1440, 1920]) {
  for (const theme of ['light', 'dark']) {
    test(`Ask AI layout and retained conversation at ${width}px in ${theme}`, async ({ page, context }, testInfo) => {
      await context.addCookies(session.cookies);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/ai/conversation', route => route.fulfill({ json: snapshot }));
      await page.goto('/');
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: 'Ask AI', exact: true });
      await expect(dialog.getByText('Your saved answer.')).toBeVisible();
      await expect(dialog.getByLabel('Message', { exact: true })).toBeEnabled();
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await dialog.getByLabel('Message', { exact: true }).fill('Show my recent history');
      const send = dialog.getByRole('button', { name: 'Send message', exact: true });
      const rect = (await send.boundingBox())!;
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
      const dialogRect = (await dialog.boundingBox())!;
      expect(rect.y + rect.height).toBeLessThanOrEqual(dialogRect.y + dialogRect.height);
      expect(await send.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target === el || el.contains(target);
      })).toBeTruthy();
      await send.focus();
      await expect(send).toBeFocused();
      await dialog.screenshot({ path: testInfo.outputPath(`ask-ai-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    });
  }
}

test('Ask AI keeps action review until requested and preserves chat when reset fails', async ({ page, context }) => {
  await context.addCookies(session.cookies);
  let resolutions = 0;
  let chats = 0;
  await page.route('**/api/ai/conversation*', route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, json: { message: 'Reset temporarily unavailable.' } })
    : route.fulfill({ json: snapshot }));
  await page.route('**/api/ai/action-batches/*/resolve', route => {
    resolutions++; return route.fulfill({ status: 204 });
  });
  await page.route('**/api/ai/chat/stream', async route => {
    chats++;
    const request = route.request().postDataJSON();
    expect(request.clientTurnId).toBeTruthy();
    expect(request.history).toEqual([]);
    const response = { reply: 'Open the existing screen to review.', actions: [{ type: 'openFoodLog', payload: {} }],
      conversationId, conversationVersion: 2, closeChat: true, actionBatch: { batchId, actions: [{ type: 'openFoodLog', payload: {} }] } };
    await route.fulfill({ contentType: 'text/event-stream',
      body: `event: delta\ndata: {"text":"Provisional text"}\n\nevent: done\ndata: ${JSON.stringify(response)}\n\n` });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Ask AI', exact: true });
  await expect(dialog.getByText('Your saved answer.')).toBeVisible();
  await dialog.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be reset');
  await expect(dialog.getByText('Your saved answer.')).toBeVisible();
  await dialog.getByLabel('Message', { exact: true }).fill('Open my history');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(dialog.getByText('Open the existing screen to review.')).toBeVisible();
  await expect(dialog.getByText('Provisional text')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  expect(resolutions).toBe(0);
  expect(chats).toBe(1);
  await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  expect(resolutions).toBe(1);
  await dialog.getByLabel('Message', { exact: true }).fill('Open my food log');
  await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Food Log', exact: true })).toBeVisible();
  expect(resolutions).toBe(2);
});
