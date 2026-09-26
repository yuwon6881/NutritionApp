import {test,expect} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';

// Large system text (200%) must not push content off the side of a phone or
// clip the bottom navigation labels.
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,'text-scale-user',[
    {name:'Greek yogurt, berries and rolled oats',time:'08:00',calories:420},
    {name:'Chicken rice bowl',time:'13:00',calories:620},
  ]);
});

test('pages survive 200% text size at phone width',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.addStyleTag({content:'html{font-size:200%!important}'});
  for(const name of ['Dashboard','Food Log','Progress','Coach']){
    await page.getByRole('button',{name,exact:true}).first().click();
    await expect(page.getByRole('heading',{name,exact:true,level:1})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),{message:`${name} overflows horizontally`}).toBe(true);
  }
  // Labels may shorten with an ellipsis, but buttons stay tappable, separate, and fully named.
  const boxes=await page.locator('.nav-mobile-items .button').evaluateAll(buttons=>buttons.map(button=>{
    const rect=button.getBoundingClientRect();
    return {left:rect.left,right:rect.right,height:rect.height};
  }));
  for(const [index,box] of boxes.entries()){
    expect(box.height).toBeGreaterThanOrEqual(44);
    if(index>0)expect(box.left).toBeGreaterThanOrEqual(boxes[index-1].right-1);
  }
  for(const name of ['Dashboard','Food Log','Progress','Coach'])await expect(page.locator('.nav-mobile-items').getByRole('button',{name,exact:true})).toBeVisible();
});
