import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'test-move');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const saved=await request.post('/api/sync',{headers,data:{
    id:randomUUID(),recordId:state.id,kind:'profile',expectedRevision:state.profileRevision,delete:false,data:{
      age:28,dateOfBirth:'1998-05-20',heightCm:175,weightKg:75,sex:'male',activity:1.4,goal:'maintain',maintenance:2600,
      proteinGrams:null,resistanceTraining:true,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0,
    }
  }});
  expect(saved.ok(),await saved.text()).toBeTruthy();
  session=await request.storageState();
});

test('food timeline supports single-item move to custom time, move to existing time, and group move',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();

  // Log first entry: Oatmeal at 08:00
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
  await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Rolled oats');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('380');
  await page.getByLabel('Protein (g)',{exact:true}).fill('13');
  await page.getByLabel('Meal time',{exact:true}).fill('08:00');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Rolled oats',exact:true})).toBeVisible();

  // Clicking anywhere in the item card does nothing (does not trigger edit)
  await page.locator('.food-time-card').filter({hasText:'Rolled oats'}).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Log second entry: Black coffee at 08:00
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Log food'}).click();
  await page.getByRole('button',{name:'Manual entry'}).click();
  await page.getByLabel('Food name',{exact:true}).fill('Black coffee');
  await page.getByLabel('Calories (kcal)',{exact:true}).fill('5');
  await page.getByLabel('Meal time',{exact:true}).fill('08:00');
  await page.getByRole('button',{name:'Add to batch',exact:true}).click();await page.getByRole('button',{name:'Log all 1 food',exact:true}).click();await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Black coffee',exact:true})).toBeVisible();

  // Check that both items are grouped under 08:00
  const row08=page.locator('[data-time-row="08:00"]');
  await expect(row08).toBeVisible();
  await expect(row08.getByText('Rolled oats')).toBeVisible();
  await expect(row08.getByText('Black coffee')).toBeVisible();

  // Enter selection mode via Day options -> Bulk select and select Rolled oats
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  const oatsAt08=row08.locator('.food-time-card').filter({hasText:'Rolled oats'}).first();
  await oatsAt08.click();
  await expect(oatsAt08).toHaveAttribute('data-selected','true');

  // Single selection displays edit, copy, move, delete
  const bar=page.getByRole('toolbar',{name:'Bulk selection actions'});
  await expect(bar.getByRole('button',{name:'Edit selected food',exact:true})).toBeVisible();
  await expect(bar.getByRole('button',{name:/Copy/})).toBeVisible();
  await expect(bar.getByRole('button',{name:/Move/})).toBeVisible();
  await expect(bar.getByRole('button',{name:/Delete/})).toBeVisible();

  // Move dialog opens with 3 options: Move to today, Move to tomorrow, Date and time
  await bar.getByRole('button',{name:/Move/}).click();
  const moveDialog=page.getByRole('dialog',{name:'Move Rolled oats'});
  await expect(moveDialog).toBeVisible();
  await expect(moveDialog.getByRole('button',{name:/Move To Today/i})).toBeVisible();
  await expect(moveDialog.getByRole('button',{name:/Move to tmr/i})).toBeVisible();
  await expect(moveDialog.getByRole('button',{name:/Date and time/i})).toBeVisible();

  // Third button switches to custom date and time picker
  await moveDialog.getByRole('button',{name:/Date and time/i}).click();
  await page.getByLabel('Move to time (optional)',{exact:true}).fill('12:15');
  await page.getByRole('button',{name:'Move',exact:true}).click();

  // Verify Rolled oats is now under 12:15 and Black coffee remains at 08:00
  const row1215=page.locator('[data-time-row="12:15"]');
  await expect(row1215).toBeVisible();
  await expect(row1215.getByText('Rolled oats')).toBeVisible();
  await expect(row1215.getByText('380 kcal')).toBeVisible();
  await expect(row08.getByText('Black coffee')).toBeVisible();
  await expect(row08.getByText('Rolled oats')).toHaveCount(0);

  // Move Black coffee to 12:15 via selection mode
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  const coffeeAt08=row08.locator('.food-time-card').filter({hasText:'Black coffee'}).first();
  await coffeeAt08.click();
  await bar.getByRole('button',{name:/Move/}).click();
  const coffeeMoveDialog=page.getByRole('dialog',{name:'Move Black coffee'});
  await coffeeMoveDialog.getByRole('button',{name:/Date and time/i}).click();
  await page.getByLabel('Move to time (optional)',{exact:true}).fill('12:15');
  await page.getByRole('button',{name:'Move',exact:true}).click();

  // Both items are now under 12:15
  await expect(row1215.getByText('Rolled oats')).toBeVisible();
  await expect(row1215.getByText('Black coffee')).toBeVisible();

  // Group move: Move all items from 12:15 PM to 19:00
  await row1215.getByRole('button',{name:/Move all/,exact:false}).click();
  const groupMoveDialog=page.getByRole('dialog',{name:'Move 2 entries'});
  await expect(groupMoveDialog).toBeVisible();
  await groupMoveDialog.getByRole('button',{name:/Date and time/i}).click();
  await page.getByLabel('Move to time (optional)',{exact:true}).fill('19:00');
  await page.getByRole('button',{name:'Move',exact:true}).click();

  // Verify group moved to 19:00
  const row19=page.locator('[data-time-row="19:00"]');
  await expect(row19).toBeVisible();
  await expect(row19.getByText('Rolled oats')).toBeVisible();
  await expect(row19.getByText('Black coffee')).toBeVisible();

  // Reload page to verify persistence across reload
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard'})).toBeVisible();
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  const reloaded19=page.locator('[data-time-row="19:00"]');
  await expect(reloaded19).toBeVisible();
  await expect(reloaded19.getByText('Rolled oats')).toBeVisible();
  await expect(reloaded19.getByText('Black coffee')).toBeVisible();

  // Multi-selection removes edit button while keeping copy, move, delete
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  const reloadedOats=reloaded19.locator('.food-time-card').filter({hasText:'Rolled oats'}).first();
  const reloadedCoffee=reloaded19.locator('.food-time-card').filter({hasText:'Black coffee'}).first();
  await reloadedOats.click();
  await expect(bar.getByRole('button',{name:'Edit selected food',exact:true})).toBeVisible();
  await reloadedCoffee.click();
  await expect(bar.getByRole('button',{name:'Edit selected food',exact:true})).toBeHidden();
  await expect(bar.getByRole('button',{name:/Copy/})).toBeVisible();
  await expect(bar.getByRole('button',{name:/Move/})).toBeVisible();
  await expect(bar.getByRole('button',{name:/Delete/})).toBeVisible();
  // Deselect coffee
  await reloadedCoffee.click();
  await expect(bar.getByRole('button',{name:'Edit selected food',exact:true})).toBeVisible();

  // Copy to clipboard and paste at 21:00
  await bar.getByRole('button',{name:/Copy/}).click();
  await expect(page.locator('.food-clipboard-banner')).toContainText('1 food copied');
  await page.getByRole('button',{name:'Full day',exact:true}).click();
  await page.locator('[data-time-row="21:00"]').getByRole('button',{name:/^Paste 1 food at/}).first().click();
  const row21=page.locator('[data-time-row="21:00"]');
  await expect(row21.getByText('Rolled oats')).toBeVisible();

  // Delete is immediate and undoable; Undo restores the same entry before anything is sent.
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  await reloadedCoffee.click();
  await bar.getByRole('button',{name:/Delete/}).click();
  const undo=page.locator('.undo-toast');
  await expect(undo).toContainText('Deleted Black coffee');
  await expect(reloaded19.getByText('Black coffee')).toHaveCount(0);
  await undo.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(reloaded19.getByText('Black coffee')).toBeVisible();

  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  await reloadedCoffee.click();
  await bar.getByRole('button',{name:/Delete/}).click();
  await expect(reloaded19.getByText('Black coffee')).toHaveCount(0);
  // Once the undo window ends the deletion is sent.
  await expect(undo).toBeHidden({timeout:10000});

  // The full diary has visible hourly drop slots.
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Food Log',exact:true})).toBeVisible();
  await expect(page.locator('[data-time-row="20:00"]')).toBeVisible();

  // Pointer drag moves an entry directly onto an empty hour.
  const moving=page.locator('[data-time-row="19:00"] .food-time-card').filter({hasText:'Rolled oats'}).first();
  const target=page.locator('[data-time-row="20:00"]');
  await target.scrollIntoViewIfNeeded();
  const from=await moving.boundingBox();
  const to=await target.boundingBox();
  expect(from).not.toBeNull();expect(to).not.toBeNull();
  await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);
  await page.mouse.down();
  await page.mouse.move(to!.x+to!.width/2,to!.y+to!.height/2,{steps:6});
  await page.mouse.up();
  await expect(page.locator('[data-time-row="20:00"] .food-time-card')).toHaveCount(1);
  await expect(page.locator('[data-time-row="20:00"]')).toContainText('Rolled oats');

  // Move to supports a date and time destination
  const copiedOats=page.locator('[data-time-row="21:00"] .food-time-card').filter({hasText:'Rolled oats'}).first();
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  await copiedOats.click();
  await bar.getByRole('button',{name:/Move/}).click();
  const dateMoveDialog=page.getByRole('dialog',{name:'Move Rolled oats'});
  await dateMoveDialog.getByRole('button',{name:/Date and time/i}).click();
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  const yesterdayIso=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'}).format(yesterday);
  await page.getByRole('dialog',{name:'Choose date and time'}).locator('#move-food-date').fill(yesterdayIso,{force:true});
  await page.getByRole('dialog',{name:'Choose date and time'}).getByLabel('Move to time (optional)',{exact:true}).fill('21:30');
  await page.getByRole('dialog',{name:'Choose date and time'}).getByRole('button',{name:'Move',exact:true}).click();
  await expect(page.locator('[data-time-row="21:30"]')).toContainText('Rolled oats');

  // Move to today redirects back to today
  const yesterdayOats=page.locator('[data-time-row="21:30"] .food-time-card').filter({hasText:'Rolled oats'}).first();
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  await yesterdayOats.click();
  await bar.getByRole('button',{name:/Move/}).click();
  const todayMoveDialog=page.getByRole('dialog',{name:'Move Rolled oats'});
  await todayMoveDialog.getByRole('button',{name:/Move To Today/i}).click();
  await expect(page.locator('.food-day-summary')).toBeVisible();
  await expect(page.getByText('Rolled oats').first()).toBeVisible();

  // Move to tomorrow redirects to tomorrow
  const todayOats=page.locator('.food-time-card').filter({hasText:'Rolled oats'}).first();
  await page.getByRole('button',{name:'Day options',exact:true}).click();
  await page.getByRole('menuitem',{name:'Bulk select',exact:true}).click();
  await todayOats.click();
  await bar.getByRole('button',{name:/Move/}).click();
  const tmrMoveDialog=page.getByRole('dialog',{name:'Move Rolled oats'});
  await tmrMoveDialog.getByRole('button',{name:/Move to tmr/i}).click();
  await expect(page.getByText('Rolled oats').first()).toBeVisible();
});
