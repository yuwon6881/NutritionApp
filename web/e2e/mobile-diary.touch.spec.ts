import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';
import {centerOf,swipe} from './helpers/touch';

// Diary ergonomics on a phone: day switching by week strip and swipe, swipe
// actions on cards, undoable deletion, and bulk actions in the thumb zone.
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'mobile-diary-user',[
    {name:'Overnight oats',time:'08:00',calories:410},
    {name:'Black coffee',time:'08:00',calories:5},
    {name:'Chicken rice bowl',time:'13:00',calories:620},
  ]);
});

test.beforeEach(async({context,page})=>{
  await context.addCookies(session.cookies);
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Food Log',exact:true,level:1})).toBeVisible();
});

const card=(page:Page,name:string)=>page.locator('.food-time-card').filter({has:page.getByRole('heading',{name})});
const dayHeading=(page:Page)=>page.locator('.food-day-summary h2');

test('calendar scrolling preserves selection and tapping changes day',async({page})=>{
  const strip=page.getByRole('group',{name:'Choose a food day'});
  await expect(strip.locator('[aria-current="date"]')).toHaveAccessibleName(/today/);
  await expect(dayHeading(page)).toHaveText('Today');
  const before=await strip.evaluate(element=>element.scrollLeft);
  const center=await centerOf(strip);
  await swipe(page,{x:center.x-100,y:center.y},{x:center.x+100,y:center.y});
  await expect.poll(()=>strip.evaluate(element=>element.scrollLeft)).toBeLessThan(before);
  await expect(dayHeading(page)).toHaveText('Today');
  const selectedDate=await strip.locator('[aria-current="date"]').getAttribute('data-date');
  const yesterday=new Date(`${selectedDate}T12:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);
  await strip.locator(`[data-date="${yesterday.toISOString().slice(0,10)}"]`).click();
  await expect(dayHeading(page)).toHaveText('Yesterday');
  await expect(strip.getByRole('button',{name:/future/}).first()).toBeDisabled();
});

test('swiping a card reveals its actions and Undo restores a deleted entry',async({page})=>{
  const coffee=card(page,'Black coffee');
  const start=await centerOf(coffee.locator('.food-time-card-details'));
  await swipe(page,start,{x:start.x-180,y:start.y+4});
  const remove=page.getByRole('button',{name:'Delete Black coffee',exact:true});
  await expect(remove).toBeVisible();

  await remove.click();
  await expect(coffee).toHaveCount(0);
  const undo=page.locator('.undo-toast');
  await expect(undo).toContainText('Deleted Black coffee');
  await undo.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(card(page,'Black coffee')).toBeVisible();
});

test('bulk actions sit above the bottom navigation and bulk delete is undoable',async({page})=>{
  await page.getByRole('button',{name:'Select food entries',exact:true}).click();
  await card(page,'Overnight oats').click();
  await card(page,'Chicken rice bowl').click();
  const bar=page.getByRole('toolbar',{name:'Bulk selection actions'});
  const viewport=page.viewportSize()!;
  const barBox=(await bar.boundingBox())!;
  expect(barBox.y+barBox.height).toBeGreaterThan(viewport.height*0.7);

  await bar.getByRole('button',{name:'Delete 2 selected foods',exact:true}).click();
  await expect(page.locator('.undo-toast')).toContainText('Deleted 2 foods');
  await expect(card(page,'Overnight oats')).toHaveCount(0);
  await page.locator('.undo-toast').getByRole('button',{name:'Undo',exact:true}).click();
  await expect(card(page,'Overnight oats')).toBeVisible();
  await expect(card(page,'Chicken rice bowl')).toBeVisible();
});
