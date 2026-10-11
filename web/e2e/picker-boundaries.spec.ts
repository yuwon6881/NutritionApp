import {test,expect,type Page,type Locator} from '@playwright/test';
import {seedMobileUser} from './helpers/seed';

const USERNAME='picker-boundary-user';
let session:Awaited<ReturnType<typeof seedMobileUser>>;

test.beforeAll(async({request})=>{
  session=await seedMobileUser(request,USERNAME,[
    {name:'Avocado toast',calories:310,time:'08:15'},
    {name:'Grilled chicken salad',calories:480,time:'12:45'},
  ]);
});

async function preparePage(page:Page,width:number,height:number,theme:'light'|'dark'='light'){
  await page.context().addCookies(session.cookies);
  await page.setViewportSize({width,height});
  await page.addInitScript(t=>localStorage.setItem('nutrition-theme',t),theme);
  await page.goto('/');
  await expect(page.locator('.account-name')).toHaveText(USERNAME);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
}

async function assertViewportContained(page:Page){
  const width=page.viewportSize()!.width;
  await expect.poll(async()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
}

async function assertElementUncovered(locator:Locator){
  await expect(locator).toBeVisible();
  const res=await locator.evaluate((el:HTMLElement)=>{
    const rect=el.getBoundingClientRect();
    if(rect.width===0||rect.height===0)return {visible:false,reason:'zero-size'};
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    if(cx<0||cx>=window.innerWidth||cy<0||cy>=window.innerHeight){
      return {visible:false,reason:`center (${cx},${cy}) out of viewport [0..${window.innerWidth}, 0..${window.innerHeight}]`};
    }
    const topEl=document.elementFromPoint(cx,cy);
    const contains=Boolean(topEl&&(el===topEl||el.contains(topEl)));
    return {
      visible:contains,
      reason:contains?'ok':`target does not contain topEl: <${topEl?.tagName.toLowerCase()} class="${topEl?.className}">`
    };
  });
  expect(res.visible,res.reason).toBe(true);
}

async function assertPopoverUnclipped(locator:Locator,allowedOverflowClasses:string[]=['custom-time-col-scroll','custom-select-menu']){
  await expect(locator).toBeVisible();
  const check=await locator.evaluate((el:HTMLElement,allowedList:string[])=>{
    const rect=el.getBoundingClientRect();
    const vw=window.innerWidth;
    const vh=window.innerHeight;
    const withinViewport=rect.left>=-1&&rect.right<=vw+1&&rect.top>=-1&&rect.bottom<=vh+1;

    let parent=el.parentElement;
    let clippedByAncestor=false;
    let clippingAncestorDesc='';
    let clippingAncestorBounds={top:0,bottom:0,left:0,right:0};
    while(parent&&parent!==document.body&&parent!==document.documentElement){
      const isAllowed=allowedList.some(cls=>parent!.classList.contains(cls));
      if(!isAllowed){
        const cs=window.getComputedStyle(parent);
        const hidesOverflow=/(auto|scroll|hidden|clip)/.test(cs.overflow+cs.overflowX+cs.overflowY);
        if(hidesOverflow){
          const pRect=parent.getBoundingClientRect();
          const margin=1;
          const extendsOutside=rect.top<pRect.top-margin||rect.bottom>pRect.bottom+margin||rect.left<pRect.left-margin||rect.right>pRect.right+margin;
          if(extendsOutside){
            clippedByAncestor=true;
            clippingAncestorDesc=`${parent.tagName.toLowerCase()}.${Array.from(parent.classList).join('.')}`;
            clippingAncestorBounds={top:pRect.top,bottom:pRect.bottom,left:pRect.left,right:pRect.right};
            break;
          }
        }
      }
      parent=parent.parentElement;
    }
    return {withinViewport,clippedByAncestor,clippingAncestorDesc,clippingAncestorBounds,rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}};
  },allowedOverflowClasses);

  expect(check.withinViewport,JSON.stringify(check)).toBe(true);
  expect(check.clippedByAncestor,JSON.stringify(check)).toBe(false);
}

test('844x390 landscape manual entry food dialog meal time popover fits viewport and is not clipped',async({page})=>{
  await preparePage(page,844,390);

  const addTrigger=page.getByRole('button',{name:'Add entry',exact:true});
  await addTrigger.click();
  const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(addSheet).toBeVisible();
  await addSheet.getByRole('button',{name:'Log food',exact:true}).click();

  const foodModal=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodModal).toBeVisible();
  await foodModal.getByRole('button',{name:'Manual entry',exact:true}).click();

  const reviewModal=page.getByRole('dialog',{name:'Review food',exact:true});
  await expect(reviewModal).toBeVisible();
  await expect(reviewModal.getByLabel('Food name')).toBeVisible();

  const mealTimeTrigger=reviewModal.locator('#food-time-trigger');
  await mealTimeTrigger.scrollIntoViewIfNeeded();
  await expect(mealTimeTrigger).toBeVisible();
  await assertViewportContained(page);
  await page.screenshot({path:'artifacts/picker-boundaries/landscape-editor-normal.png'});

  await mealTimeTrigger.click();
  const timePopover=reviewModal.getByRole('dialog',{name:'Choose Meal time',exact:true});
  await expect(timePopover).toBeVisible();

  await assertPopoverUnclipped(timePopover);
  await assertElementUncovered(timePopover.getByRole('button',{name:'Now',exact:true}));
  await assertElementUncovered(timePopover.getByRole('button',{name:'Done',exact:true}));

  const stickyFooter=reviewModal.locator('.modal-actions');
  if(await stickyFooter.count()>0&&await stickyFooter.isVisible()){
    // If popover geometrically overlaps the footer, ensure popover remains on top (uncovered by footer)
    const popoverBox=await timePopover.boundingBox();
    const footerBox=await stickyFooter.boundingBox();
    if(popoverBox&&footerBox){
      const overlapsFooter=popoverBox.y+popoverBox.height>footerBox.y+1&&popoverBox.y<footerBox.y+footerBox.height;
      if(overlapsFooter){
        await assertElementUncovered(timePopover.getByRole('button',{name:'Done',exact:true}));
      }
    }
  }

  await page.screenshot({path:'artifacts/picker-boundaries/landscape-time-picker-openmenu.png'});

  await page.keyboard.press('Escape');
  await expect(timePopover).toHaveCount(0);
  await expect(reviewModal).toBeVisible();
  await expect(reviewModal.getByLabel('Food name')).toBeVisible();
  await expect(mealTimeTrigger).toBeVisible();
  await expect(mealTimeTrigger).toBeFocused();

  const backButton=reviewModal.getByRole('button',{name:'Back',exact:true}).first();
  await backButton.click();
  const discardAlert=page.getByRole('alertdialog');
  if(await discardAlert.isVisible()){
    await discardAlert.getByRole('button',{name:'Discard changes'}).click();
  }
  await expect(foodModal.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
});

test('360x800 normal and 200% root text portion unit and meal time reachability at boundary',async({page})=>{
  await preparePage(page,360,800);

  const addTrigger=page.getByRole('button',{name:'Add entry',exact:true});
  await addTrigger.click();
  const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(addSheet).toBeVisible();
  await addSheet.getByRole('button',{name:'Log food',exact:true}).click();

  const foodModal=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodModal).toBeVisible();
  await foodModal.getByRole('button',{name:'Manual entry',exact:true}).click();

  const reviewModal=page.getByRole('dialog',{name:'Review food',exact:true});
  await expect(reviewModal).toBeVisible();
  await assertViewportContained(page);
  await page.screenshot({path:'artifacts/picker-boundaries/portrait-editor-normal.png'});

  const unitTrigger=reviewModal.getByRole('button',{name:'Choose unit',exact:true});
  await unitTrigger.scrollIntoViewIfNeeded();
  await assertElementUncovered(unitTrigger);
  await unitTrigger.click();

  const unitListbox=reviewModal.getByRole('listbox',{name:'Unit',exact:true});
  await expect(unitListbox).toBeVisible();
  await assertPopoverUnclipped(unitListbox);
  await page.screenshot({path:'artifacts/picker-boundaries/portrait-unit-select-openmenu.png'});

  const gramsOption=unitListbox.getByRole('option',{name:'Grams',exact:true});
  await assertElementUncovered(gramsOption);
  await gramsOption.click();
  await expect(unitListbox).toHaveCount(0);
  await expect(reviewModal.locator('#food-unit-value')).toHaveText('Grams');

  const mealTimeTrigger=reviewModal.locator('#food-time-trigger');
  await mealTimeTrigger.scrollIntoViewIfNeeded();
  await assertElementUncovered(mealTimeTrigger);
  await mealTimeTrigger.click();

  const timePopover=reviewModal.getByRole('dialog',{name:'Choose Meal time',exact:true});
  await expect(timePopover).toBeVisible();
  await assertPopoverUnclipped(timePopover);
  await page.screenshot({path:'artifacts/picker-boundaries/portrait-time-picker-openmenu.png'});

  const doneButton=timePopover.getByRole('button',{name:'Done',exact:true});
  await assertElementUncovered(doneButton);
  await doneButton.click();
  await expect(timePopover).toHaveCount(0);
  await expect(mealTimeTrigger).toBeVisible();

  await page.addStyleTag({content:'html{font-size:200%!important}'});
  await assertViewportContained(page);
  await page.screenshot({path:'artifacts/picker-boundaries/portrait-200pct-text-shortheight.png'});

  await unitTrigger.scrollIntoViewIfNeeded();
  await assertElementUncovered(unitTrigger);
  await unitTrigger.click();
  await expect(unitListbox).toBeVisible();
  await assertPopoverUnclipped(unitListbox);
  await page.screenshot({path:'artifacts/picker-boundaries/portrait-200pct-unit-openmenu.png'});

  const servingOption=unitListbox.getByRole('option',{name:'Serving (weight unknown)',exact:true});
  await servingOption.scrollIntoViewIfNeeded();
  await assertElementUncovered(servingOption);
  await servingOption.click();
  await expect(unitListbox).toHaveCount(0);
  await expect(reviewModal.locator('#food-unit-value')).toHaveText('Serving (weight unknown)');

  await mealTimeTrigger.scrollIntoViewIfNeeded();
  await assertElementUncovered(mealTimeTrigger);
  await mealTimeTrigger.click();
  await expect(timePopover).toBeVisible();
  await assertPopoverUnclipped(timePopover);
  await page.screenshot({path:'artifacts/picker-boundaries/portrait-200pct-time-openmenu.png'});

  const nowButton=timePopover.getByRole('button',{name:'Now',exact:true});
  await assertElementUncovered(nowButton);
  await page.keyboard.press('Escape');
  await expect(timePopover).toHaveCount(0);
  await expect(mealTimeTrigger).toBeVisible();

  const commitButton=reviewModal.getByRole('button',{name:'Add to batch',exact:true});
  await commitButton.scrollIntoViewIfNeeded();
  await assertElementUncovered(commitButton);
  await assertViewportContained(page);
});
