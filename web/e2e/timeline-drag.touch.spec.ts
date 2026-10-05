import {test,expect,type Page} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';
import {centerOf} from './helpers/touch';

// A lifted card owns the finger, so hours off screen are reached by holding
// the card near the edge of the visible area, which scrolls the page.
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'timeline-drag-user',[
    {name:'Early porridge',time:'06:00',calories:350},
    {name:'Late snack',time:'22:00',calories:180},
  ]);
});

test.beforeEach(async({context})=>{await context.addCookies(session.cookies);});

async function openFullDay(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Food Log',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Food Log',exact:true,level:1})).toBeVisible();
  await page.getByRole('button',{name:'Full day',exact:true}).click();
  await expect(page.locator('[data-time-row="20:00"]')).toBeAttached();
}

test('a lifted card follows the finger and auto-scrolls toward hours off screen',async({page})=>{
  await openFullDay(page);
  const porridge=page.locator('.food-time-card').filter({has:page.getByRole('heading',{name:'Early porridge'})});
  const from=await centerOf(porridge.locator('.food-time-card-details'));
  const viewport=page.viewportSize()!;
  const session=await page.context().newCDPSession(page);
  const touch=(type:'touchStart'|'touchMove'|'touchEnd',point?:{x:number;y:number})=>
    session.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:Math.round(point.x),y:Math.round(point.y)}]:[]});
  try{
    await touch('touchStart',from);
    await page.waitForTimeout(550);
    // The floating copy appears on lift and the card's own place turns into an outline.
    await expect(page.locator('.food-drag-ghost')).toHaveCount(1);
    await expect(porridge).toHaveAttribute('data-dragging','true');

    const edge={x:from.x,y:viewport.height-110};
    for(let step=1;step<=10;step++)await touch('touchMove',{x:from.x,y:from.y+(edge.y-from.y)*step/10});
    const ghostBox=(await page.locator('.food-drag-ghost').boundingBox())!;
    expect(Math.abs(ghostBox.y+ghostBox.height/2-edge.y)).toBeLessThan(ghostBox.height);

    const scrollBefore=await page.evaluate(()=>scrollY);
    // Holding still near the bottom keeps scrolling without further finger movement.
    await expect.poll(()=>page.evaluate(()=>scrollY),{timeout:5000}).toBeGreaterThan(scrollBefore+200);
    await touch('touchMove',{x:edge.x,y:viewport.height/2});
    await page.waitForTimeout(120);
    const target=await page.locator('.food-time-row[data-drop-over]').getAttribute('data-time-row');
    expect(target).not.toBeNull();
    expect(target!>'06:00').toBeTruthy();
    await touch('touchEnd');

    await expect(page.locator('.food-drag-ghost')).toHaveCount(0);
    await expect(page.locator(`.food-time-row[data-time-row="${target}"]`).getByRole('heading',{name:'Early porridge'})).toBeVisible();
    // Nothing is left holding the page: it scrolls normally after the drop.
    await expect(page.locator('.food-time-card[data-dragging]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.dataset.cardDragging)).toBeUndefined();
  }finally{await session.detach();}
});

test('releasing a lifted card where it started puts it back without moving it',async({page})=>{
  await openFullDay(page);
  const snack=page.locator('.food-time-card').filter({has:page.getByRole('heading',{name:'Late snack'})});
  const from=await centerOf(snack.locator('.food-time-card-details'));
  const session=await page.context().newCDPSession(page);
  const touch=(type:'touchStart'|'touchMove'|'touchEnd',point?:{x:number;y:number})=>
    session.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:Math.round(point.x),y:Math.round(point.y)}]:[]});
  try{
    await touch('touchStart',from);
    await page.waitForTimeout(550);
    await touch('touchMove',{x:from.x+30,y:from.y+12});
    await touch('touchMove',{x:from.x,y:from.y});
    await touch('touchEnd');
  }finally{await session.detach();}
  await expect(page.locator('.food-drag-ghost')).toHaveCount(0);
  await expect(page.locator('.food-time-row[data-time-row="22:00"]').getByRole('heading',{name:'Late snack'})).toBeVisible();
});
