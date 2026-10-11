import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signInApi} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  expect((await request.post('/api/auth/dev-reset',{headers})).ok()).toBeTruthy();
  const response=await signInApi(request,'redesign-a11y-review');
  expect(response.ok(),await response.text()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    const saved=await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
    expect(saved.ok(),await saved.text()).toBeTruthy();
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  expect((await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}})).ok()).toBeTruthy();
  const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(let offset=13;offset>=0;offset--){
    const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    await save('weight',{date,kg:80.5+offset*.06+(offset%3)*.12});
    await save('entry',{date,name:'Greek yogurt, berries and rolled oats',calories:420,protein:28,carbs:52,fat:12,fiber:7,quantity:1,unit:'serving',time:'08:00'});
  }
  await save('entry',{date:current,name:'Grilled chicken with brown rice and vegetables',calories:640,protein:46,carbs:68,fat:18,fiber:9,quantity:1,unit:'serving',time:'12:30'});
  session=await request.storageState();
});

for(const width of [390,768,1440])for(const theme of ['light','dark']){
  test(`${theme} ${width}px: redesign font, theme, field size, and controls contract`,async({page,context})=>{
    await context.addCookies(session.cookies);
    await page.setViewportSize({width,height:900});
    await page.addInitScript(t=>localStorage.setItem('nutrition-theme',t),theme);
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();

    // 1. Manrope Variable font face is loaded into document memory and applied to body
    await expect.poll(async()=>page.evaluate(async()=>{
      await document.fonts.ready;
      const bodyFont=getComputedStyle(document.body).fontFamily;
      const hasLoadedFace=Array.from(document.fonts).some(f=>f.family.includes('Manrope')&&f.status==='loaded');
      return bodyFont.includes('Manrope')&&hasLoadedFace;
    }),{message:'Manrope Variable font must be loaded in document memory and applied to body'}).toBe(true);

    // 2. Consistent warm theme / HTML theme-color
    const metaTheme=await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(metaTheme?.toLowerCase()).toBe(theme==='dark'?'#121916':'#f5f3ee');
    const bodyBg=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe(theme==='dark'?'rgb(18, 25, 22)':'rgb(245, 243, 238)');

    // 3. Desktop nav labels not accidentally reduced by accessibility.css to .72rem (~11.5px)
    if(width>=1024){
      const navButtons=page.locator('.sidebar nav .button:visible');
      const navFontSizes=await navButtons.evaluateAll(btns=>btns.map(b=>parseFloat(getComputedStyle(b).fontSize)));
      expect(navFontSizes.length).toBeGreaterThan(0);
      for(const size of navFontSizes){
        expect(size).toBeGreaterThanOrEqual(14);
      }
    }

    // 4. Primary sheet actions at least 48px, field text >= 16px at normal size, and focus restoration
    const launcher=page.getByRole('button',{name:'Add entry',exact:true});
    await launcher.click();
    const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
    await expect(addSheet).toBeVisible();

    const sheetActions=addSheet.locator('.action-sheet-item, .button.primary');
    const actionHeights=await sheetActions.evaluateAll(items=>items.map(el=>el.getBoundingClientRect().height));
    expect(actionHeights.length).toBeGreaterThan(0);
    for(const h of actionHeights){
      expect(h).toBeGreaterThanOrEqual(48);
    }

    await addSheet.getByRole('button',{name:'Log food'}).click();
    const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
    await expect(foodDialog).toBeVisible();

    // Check visible input/select/textarea text size is at least 16px (no blanket check on compact captions)
    const fieldSizes=await foodDialog.locator('input:visible:not([type=checkbox]):not([type=file]):not([type=radio]), select:visible, textarea:visible').evaluateAll(inputs=>
      inputs.map(input=>parseFloat(getComputedStyle(input).fontSize))
    );
    expect(fieldSizes.length).toBeGreaterThan(0);
    for(const size of fieldSizes){
      expect(size).toBeGreaterThanOrEqual(16);
    }

    // Dismiss dialog via Escape and verify focus restores to launcher
    await page.keyboard.press('Escape');
    if(await addSheet.isVisible())await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(launcher).toBeFocused();
  });
}

test('200% text enlargement on dense Dashboard and Log food without clipping or overlap',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();

  await page.addStyleTag({content:'html{font-size:200%!important}'});

  // Verify horizontal containment using viewportSize().width, not innerWidth
  const viewportWidth=page.viewportSize()!.width;
  await expect.poll(async()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth+1);

  // Dense dashboard: energy overview triplet (left value, ring, target value) without inventing h2
  const energyPanel=page.locator('.energy-panel');
  await expect(energyPanel).toBeVisible();
  expect(await energyPanel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);

  const leftSide=energyPanel.locator('.energy-side.energy-left');
  const leftStrong=leftSide.locator('strong');
  const ring=energyPanel.locator('.energy-ring');
  const targetSide=energyPanel.locator('.energy-side.energy-target');
  const targetStrong=targetSide.locator('strong');

  await expect(leftStrong).toBeVisible();
  await expect(ring).toBeVisible();
  await expect(targetStrong).toBeVisible();

  // Actual left/target values and ring accessible name
  expect((await leftStrong.innerText()).trim().length).toBeGreaterThan(0);
  expect((await targetStrong.innerText()).trim().length).toBeGreaterThan(0);
  await expect(ring).toHaveAttribute('aria-label',/logged/);

  // Unclipped text on strong elements
  expect(await leftStrong.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await targetStrong.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);

  // Geometry: ring size and pairwise triplet non-overlapping bounding boxes
  const leftBox=await leftSide.boundingBox();
  const ringBox=await ring.boundingBox();
  const targetBox=await targetSide.boundingBox();
  expect(leftBox).not.toBeNull();
  expect(ringBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(ringBox!.width).toBeGreaterThanOrEqual(44);
  expect(ringBox!.height).toBeGreaterThanOrEqual(44);

  const overlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>
    a.x<b.x+b.width-0.5&&a.x+a.width>b.x+0.5&&a.y<b.y+b.height-0.5&&a.y+a.height>b.y+0.5;
  expect(overlap(leftBox!,ringBox!)).toBe(false);
  expect(overlap(ringBox!,targetBox!)).toBe(false);
  expect(overlap(leftBox!,targetBox!)).toBe(false);

  // Open Log food sheet under 200% zoom
  const launcher=page.getByRole('button',{name:'Add entry',exact:true});
  await launcher.click();
  const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(addSheet).toBeVisible();
  await addSheet.getByRole('button',{name:'Log food'}).click();

  const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodDialog).toBeVisible();

  // Modal body is an accessible vertical scroll container accommodating enlarged content
  const modalBody=foodDialog.locator('.modal-body');
  await expect(modalBody).toBeVisible();
  const overflowY=await modalBody.evaluate(el=>getComputedStyle(el).overflowY);
  expect(['auto','scroll']).toContain(overflowY);
  expect(await modalBody.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);

  // Exercise actual primary food action in Manual entry
  await foodDialog.getByRole('button',{name:'Manual entry',exact:true}).click();
  const editorDialog=page.getByRole('dialog',{name:'Review food',exact:true});
  await expect(editorDialog).toBeVisible();
  await editorDialog.getByLabel('Food name').fill('Apple');
  await editorDialog.locator('#food-calories').fill('95');

  const addToBatch=editorDialog.getByRole('button',{name:'Add to batch',exact:true});
  await expect(addToBatch).toBeVisible();
  const addBox=await addToBatch.boundingBox();
  expect(addBox).not.toBeNull();
  expect(addBox!.height).toBeGreaterThanOrEqual(48);

  const notCovered=await addToBatch.evaluate(el=>{
    const r=el.getBoundingClientRect();
    const topEl=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return el.contains(topEl)||topEl?.closest('button')===el;
  });
  expect(notCovered).toBe(true);

  // Modal actions footer within dialog
  const modalActions=editorDialog.locator('.modal-actions');
  await expect(modalActions).toBeVisible();
  const actionsBox=await modalActions.boundingBox();
  const dialogBox=await editorDialog.boundingBox();
  expect(actionsBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(actionsBox!.y+actionsBox!.height).toBeLessThanOrEqual(dialogBox!.y+dialogBox!.height+2);
  expect(actionsBox!.x).toBeGreaterThanOrEqual(dialogBox!.x-2);
  expect(actionsBox!.x+actionsBox!.width).toBeLessThanOrEqual(dialogBox!.x+dialogBox!.width+2);

  // Escape respects dirty confirmation; discard returns to selection
  await page.keyboard.press('Escape');
  const confirmDialog=page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button',{name:'Discard changes',exact:true}).click();

  // Returned to selection then dismiss and restore focus
  await expect(foodDialog.getByRole('button',{name:'Manual entry',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  if(await addSheet.isVisible())await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launcher).toBeFocused();
});

test('reduced motion disables layout transitions while preserving dialog operation and focus restoration',async({page,context})=>{
  await context.addCookies(session.cookies);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:768,height:900});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();

  const isReduced=await page.evaluate(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(isReduced).toBe(true);

  // Scene entrance has no running Web Animations under reduced motion
  const sceneAnimations=await page.locator('.motion-scene').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length);
  expect(sceneAnimations).toBe(0);

  const launcher=page.getByRole('button',{name:'Add entry',exact:true});
  await launcher.click();
  const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
  await expect(addSheet).toBeVisible();

  // Dialog animation/transition duration is 0 / disabled
  const dialogMotion=await addSheet.evaluate(el=>{
    const s=getComputedStyle(el);
    return {
      animName:s.animationName,
      animDuration:parseFloat(s.animationDuration)||0,
      transDuration:parseFloat(s.transitionDuration)||0,
    };
  });
  expect(dialogMotion.animName==='none'||dialogMotion.animDuration===0).toBe(true);
  expect(dialogMotion.transDuration).toBe(0);

  // All dialog content/buttons remain visible and operable
  await expect(addSheet.getByRole('button',{name:'Log food'})).toBeVisible();
  await expect(addSheet.getByRole('button',{name:'Log weight'})).toBeVisible();

  // Dismiss via Escape restores focus to launcher
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launcher).toBeFocused();
});
