import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
const credentials={username:'sync-feedback',password:'nutrition sync feedback 2026'};

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
});

test('fast saves keep server feedback readable through completion',async({page,context})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'New here? Create an account',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill(credentials.username);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Set up profile',exact:true})).toBeVisible();

  const state=await (await context.request.get('/api/state')).json();
  const profile={dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0};
  const saved=await context.request.post('/api/sync',{headers,data:{id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:profile}});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  const preview=await (await context.request.get('/api/coach/preview')).json();
  const accepted=await context.request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}});
  expect(accepted.ok(),await accepted.text()).toBeTruthy();

  await page.reload();
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Diary',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  const addDialog=page.getByRole('dialog',{name:'Add',exact:true});
  await addDialog.getByRole('button',{name:'Log food'}).click();
  await page.getByRole('button',{name:'Manual entry',exact:true}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Stable feedback test');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('250');
  await page.getByRole('button',{name:'Save reviewed food',exact:true}).click();

  // Ordinary autosaves use the quiet delayed topbar indicator; no routine success toast or checkmark
  await expect(page.locator('.sync-status-synced')).toHaveCount(0);
  await expect(page.getByText('All changes saved',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Stable feedback test',{exact:true})).toBeVisible();

  // Test discard confirmation across shared modal
  const weighInBtn=page.getByRole('button',{name:'Add weigh-in',exact:true});
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Progress',exact:true})).toBeVisible();
  await weighInBtn.click();

  const weightModal=page.getByRole('dialog',{name:'Log weight',exact:true});
  await expect(weightModal).toBeVisible();
  const kgInput=weightModal.getByLabel(/Weight/);
  await kgInput.fill('79.5');

  // Attempt to dismiss by clicking the close button
  await weightModal.getByRole('button',{name:'Close dialog',exact:true}).click();

  // Discard confirmation appears as an alertdialog
  const confirmDialog=page.getByRole('alertdialog',{name:'Discard changes?',exact:true});
  await expect(confirmDialog).toBeVisible();
  const keepEditingBtn=confirmDialog.getByRole('button',{name:'Keep editing',exact:true});
  await expect(keepEditingBtn).toBeFocused();

  // The underlying editor remains mounted and visible beneath the confirmation layer
  await expect(kgInput).toBeVisible();
  await expect(kgInput).toHaveValue('79.5');

  // Backdrop click while confirming does nothing
  await page.mouse.click(10,10);
  await expect(confirmDialog).toBeVisible();

  // Escape dismisses only the confirmation and restores focus to the input
  await page.keyboard.press('Escape');
  await expect(confirmDialog).toHaveCount(0);
  await expect(weightModal).toBeVisible();
  await expect(kgInput).toBeFocused();
  await expect(kgInput).toHaveValue('79.5');

  // Open confirmation again and confirm discard
  await weightModal.getByRole('button',{name:'Close dialog',exact:true}).click();
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button',{name:'Discard changes',exact:true}).click();

  // Dialog closes and focus restores to the page trigger
  await expect(weightModal).toHaveCount(0);
  await expect(weighInBtn).toBeFocused();
});

