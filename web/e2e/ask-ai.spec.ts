import { test, expect } from '@playwright/test';
import { seedMobileUser } from './helpers/seed';

// Exercise the network-bound first load; a precached service worker bypasses route interception.
test.use({serviceWorkers:'block'});

const conversationId = '11111111-1111-1111-1111-111111111111';
const batchId = '22222222-2222-2222-2222-222222222222';
const snapshot = { conversationId, conversationVersion: 1, state: null,
  messages: [{ role: 'user', content: 'My previous question' }, { role: 'assistant', content: 'Your saved answer.' }],
  pendingActionBatches: [] };
let session: Awaited<ReturnType<typeof seedMobileUser>>;
test.beforeAll(async ({ request }) => { session = await seedMobileUser(request, 'ask-ai-review', []); });

test('first Ask AI launch responds before its chunk loads and remains dismissible',async({page,context})=>{
  await context.addCookies(session.cookies);
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  let requested!:()=>void;
  const warming=new Promise<void>(resolve=>{requested=resolve;});
  let conversations=0;
  await page.route('**/assets/AiAssistantPanel-*.js',async route=>{
    requested();await held;await route.continue();
  });
  await page.route('**/api/ai/conversation',route=>{conversations++;return route.fulfill({json:snapshot});});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  // Idle warming downloads code only; it does not start a conversation or call an AI provider.
  await warming;
  expect(conversations).toBe(0);
  const trigger=page.getByRole('button',{name:'Ask AI',exact:true}).last();
  const dialog=page.getByRole('dialog',{name:'Ask AI',exact:true});
  try{
    await trigger.click();
    await expect(dialog).toBeVisible({timeout:1000});
    await expect(dialog.getByRole('status')).toHaveText('Loading conversation…');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await trigger.click();
  }finally{release();}
  await expect(dialog.getByText('Your saved answer.')).toBeVisible();
  await expect(dialog.getByLabel('Message',{exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const width of [320, 390, 640, 768, 1024, 1440, 1920]) {
  for (const theme of ['light', 'dark']) {
    test(`Ask AI layout and retained conversation at ${width}px in ${theme}`, async ({ page, context }, testInfo) => {
      await context.addCookies(session.cookies);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(t => { localStorage.setItem('nutrition-theme', t); }, theme);
      await page.route('**/api/ai/conversation', route => route.fulfill({ json: snapshot }));
      await page.goto('/');
      await expect(page.locator('.account-name')).toHaveText('ask-ai-review', { timeout: 30000 });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: 'Ask AI', exact: true });
      await expect(dialog.getByText('Your saved answer.')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const expectedBg = theme === 'dark' ? 'rgb(20, 20, 23)' : 'rgb(255, 255, 255)';
      await expect(dialog.locator('.modal-surface')).toHaveCSS('background-color', expectedBg);
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

test('reviewed food action opens search with the verified name rather than its barcode',async({page,context})=>{
  await context.addCookies(session.cookies);
  const action={type:'openAddFoodDraft',payload:{foodId:'12345678',query:'Rolled oats'}};
  await page.route('**/api/ai/conversation',route=>route.fulfill({json:{...snapshot,pendingActionBatches:[{batchId,actions:[action]}]}}));
  await page.route('**/api/ai/action-batches/*/resolve',route=>route.fulfill({status:204}));
  await page.route('**/api/foods/search?*',route=>route.fulfill({json:[]}));
  await page.goto('/');
  await page.getByRole('button',{name:'Ask AI',exact:true}).last().click();
  const dialog=page.getByRole('dialog',{name:'Ask AI',exact:true});
  await dialog.getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.getByLabel('Search term',{exact:true})).toHaveValue('Rolled oats');
  await expect(page.locator('.batch-food')).toHaveCount(0);
});

test('Ask AI chat composer expands vertically for lengthy text, maintains 24px radius, and preserves 44x44 circular button', async ({ page, context }, testInfo) => {
  await context.addCookies(session.cookies);
  await page.route('**/api/ai/conversation', route => route.fulfill({ json: snapshot }));
  await page.goto('/');
  await expect(page.locator('.account-name')).toHaveText('ask-ai-review', { timeout: 30000 });

  const lengthyText = 'because i am about to head to rave later at 7pm, now is already 1pm, i have one more workout session left, going to the rave means i am definitely going to drink, thats why i allocated most protein prior to the rave, i wonder, which is better approach, should i go to gym now, and drink whey protein after or something else?';

  await page.getByRole('button', { name: 'Ask AI', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Ask AI', exact: true });
  await expect(dialog.getByText('Your saved answer.')).toBeVisible();

  const composerBox = dialog.locator('.ai-chat-composer-box');
  const textarea = dialog.getByLabel('Message', { exact: true });
  const sendButton = dialog.getByRole('button', { name: 'Send message', exact: true });

  // 1. Empty state: compact ~56px height (within 54-60px), 24px border radius, disabled 44x44 circular send button
  await expect(textarea).toHaveValue('');
  const emptyBoxRect = (await composerBox.boundingBox())!;
  expect(emptyBoxRect.height).toBeGreaterThanOrEqual(54);
  expect(emptyBoxRect.height).toBeLessThanOrEqual(60);
  const emptyTextareaHeight = await textarea.evaluate(el => el.getBoundingClientRect().height);
  expect(emptyTextareaHeight).toBeGreaterThanOrEqual(42);
  expect(emptyTextareaHeight).toBeLessThanOrEqual(46);
  await expect(sendButton).toBeDisabled();
  const emptySendRect = (await sendButton.boundingBox())!;
  expect(emptySendRect.width).toBe(44);
  expect(emptySendRect.height).toBe(44);
  const emptyBoxRadius = await composerBox.evaluate(el => getComputedStyle(el).borderTopLeftRadius);
  expect(emptyBoxRadius).toBe('24px');

  // 2. Short text state: retains compact ~56px height, enables send button
  await textarea.fill('Show my recent history');
  const shortBoxRect = (await composerBox.boundingBox())!;
  expect(shortBoxRect.height).toBeGreaterThanOrEqual(54);
  expect(shortBoxRect.height).toBeLessThanOrEqual(60);
  const shortTextareaHeight = await textarea.evaluate(el => el.getBoundingClientRect().height);
  expect(shortTextareaHeight).toBeGreaterThanOrEqual(42);
  expect(shortTextareaHeight).toBeLessThanOrEqual(46);
  await expect(sendButton).toBeEnabled();
  const shortSendRect = (await sendButton.boundingBox())!;
  expect(shortSendRect.width).toBe(44);
  expect(shortSendRect.height).toBe(44);
  const shortBoxRadius = await composerBox.evaluate(el => getComputedStyle(el).borderTopLeftRadius);
  expect(shortBoxRadius).toBe('24px');

  // 3. Lengthy multi-line text state: expands vertically up to max-height (<= 144px), radius stays 24px, send button pinned 44x44
  await textarea.fill(lengthyText);
  await expect(async () => {
    const height = await textarea.evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(80);
    expect(height).toBeLessThanOrEqual(144);
  }).toPass();

  const lengthyBoxRect = (await composerBox.boundingBox())!;
  expect(lengthyBoxRect.height).toBeGreaterThan(90);

  // Border-radius stays 24px (does NOT balloon into 999px / half-height ellipse)
  const lengthyBoxRadii = await composerBox.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      tl: cs.borderTopLeftRadius,
      tr: cs.borderTopRightRadius,
      bl: cs.borderBottomLeftRadius,
      br: cs.borderBottomRightRadius,
    };
  });
  expect(lengthyBoxRadii.tl).toBe('24px');
  expect(lengthyBoxRadii.tr).toBe('24px');
  expect(lengthyBoxRadii.bl).toBe('24px');
  expect(lengthyBoxRadii.br).toBe('24px');

  // Send button strictly 44x44px circular and pinned to bottom-right
  const lengthySendRect = (await sendButton.boundingBox())!;
  expect(lengthySendRect.width).toBe(44);
  expect(lengthySendRect.height).toBe(44);
  const sendRadius = await sendButton.evaluate(el => getComputedStyle(el).borderRadius);
  expect(sendRadius).toBe('50%');

  // Pinned to bottom-right of composer box
  const bottomOffset = (lengthyBoxRect.y + lengthyBoxRect.height) - (lengthySendRect.y + lengthySendRect.height);
  expect(bottomOffset).toBeGreaterThanOrEqual(5);
  expect(bottomOffset).toBeLessThanOrEqual(10);
  const rightOffset = (lengthyBoxRect.x + lengthyBoxRect.width) - (lengthySendRect.x + lengthySendRect.width);
  expect(rightOffset).toBeGreaterThanOrEqual(5);
  expect(rightOffset).toBeLessThanOrEqual(10);

  // Capture screenshot of the expanded multi-line state
  await dialog.screenshot({ path: testInfo.outputPath('ask-ai-lengthy-expansion-multiline.png') });

  // 4. Shrinks back to compact ~56px when cleared
  await textarea.fill('');
  await expect(async () => {
    const clearedBoxRect = (await composerBox.boundingBox())!;
    expect(clearedBoxRect.height).toBeGreaterThanOrEqual(54);
    expect(clearedBoxRect.height).toBeLessThanOrEqual(60);
  }).toPass();
  await expect(sendButton).toBeDisabled();

  // Capture screenshot of the cleared/compact state
  await dialog.screenshot({ path: testInfo.outputPath('ask-ai-lengthy-expansion-cleared.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

