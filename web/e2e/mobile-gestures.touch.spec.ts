import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';
import {centerOf,holdAndDrag,longPress,swipe} from './helpers/touch';

// One gesture model on diary cards: hold still to select, hold then move to
// drag, and move early to scroll. Uses real touch events (pointerType touch).
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'mobile-gesture-user',[
    {name:'Overnight oats',time:'08:00',calories:410},
    {name:'Black coffee',time:'08:00',calories:5},
    {name:'Chicken rice bowl',time:'13:00',calories:620},
    {name:'Apple',time:'16:00',calories:95},
    {name:'Salmon and greens',time:'19:00',calories:540},
  ]);
});

async function openFoodLog(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Food Log',exact:true,level:1})).toBeVisible();
}

const card=(page:Page,name:string)=>page.locator('.food-time-card').filter({has:page.getByRole('heading',{name})});

test.beforeEach(async({context})=>{await context.addCookies(session.cookies);});

test('holding a card still selects it, and the page still scrolls afterwards',async({page})=>{
  await openFoodLog(page);
  const oats=card(page,'Overnight oats');
  // Hold on the card body, away from its buttons.
  await longPress(page,oats.locator('.food-time-card-details'));

  await expect(page.getByRole('button',{name:'Done selecting',exact:true})).toBeVisible();
  await expect(oats).toHaveAttribute('data-selected','true');
  // The release after a hold must not toggle the new selection straight back off.
  await page.waitForTimeout(150);
  await expect(oats).toHaveAttribute('data-selected','true');
  await expect(card(page,'Black coffee')).not.toHaveAttribute('data-selected','true');

  const scrollBefore=await page.evaluate(()=>window.scrollY);
  const viewport=page.viewportSize()!;
  await swipe(page,{x:viewport.width/2,y:viewport.height*0.75},{x:viewport.width/2,y:viewport.height*0.25});
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(scrollBefore);
});

test('holding then moving a card drags it to another hour',async({page})=>{
  await openFoodLog(page);
  const apple=card(page,'Apple');
  const targetRow=page.locator('.food-time-row[data-time-row="13:00"]');
  await targetRow.scrollIntoViewIfNeeded();
  const target=await centerOf(targetRow.locator('.food-time-label'));

  await holdAndDrag(page,apple.locator('.food-time-card-details'),target);

  await expect(targetRow.locator('.food-time-card').filter({has:page.getByRole('heading',{name:'Apple'})})).toBeVisible();
  await expect(page.getByRole('button',{name:'Select food entries',exact:true})).toBeVisible();
});

test('a quick flick over a card scrolls instead of selecting or dragging',async({page})=>{
  await openFoodLog(page);
  const start=await centerOf(card(page,'Chicken rice bowl').locator('.food-time-card-details'));
  const scrollBefore=await page.evaluate(()=>window.scrollY);
  // Flick toward whichever end the page can still move to.
  const towardTop=scrollBefore>0;
  await swipe(page,start,{x:start.x,y:towardTop?start.y+250:Math.max(10,start.y-250)});

  await expect.poll(()=>page.evaluate(()=>window.scrollY)).not.toBe(scrollBefore);
  await expect(page.getByRole('button',{name:'Select food entries',exact:true})).toBeVisible();
  await expect(page.locator('.food-time-card[data-dragging]')).toHaveCount(0);
});

test('number fields ask phones for the matching keypad',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Add entry',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Add',exact:true}).getByRole('button',{name:'Log weight'}).click();
  const weight=page.getByRole('dialog').getByLabel(/^Weight \(/);
  await expect(weight).toHaveAttribute('inputmode','decimal');
  await expect(weight).toHaveAttribute('enterkeyhint','done');
});
