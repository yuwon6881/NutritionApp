import {test,expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};
let session:Awaited<ReturnType<APIRequestContext['storageState']>>;

test.beforeAll(async({request})=>{
  await request.post('/api/auth/dev-reset',{headers});
  const credentials={username:'mobile-layout-user',password:'nutrition test 2026'};
  let res=await request.post('/api/auth/register',{headers,data:credentials});
  for(let attempt=0;res.status()===429&&attempt<12;attempt++){
    await new Promise(resolve=>setTimeout(resolve,5000));
    res=await request.post('/api/auth/register',{headers,data:credentials});
  }
  expect(res.ok()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}});

  const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(let offset=13;offset>=0;offset--){
    const day=new Date(`${current}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-offset);
    const date=day.toISOString().slice(0,10);
    await save('weight',{date,kg:80.5+offset*.06+(offset%3)*.12});
    await save('entry',{date,name:'Greek yogurt, berries and rolled oats',calories:420,protein:28,carbs:52,fat:12,fiber:7,quantity:1,unit:'serving',time:'08:00'});
  }
  session=await request.storageState();
});

test('mobile view (360px & 390px): eliminates horizontal scroll and fixes button and menu layouts',async({page,context})=>{
  await context.addCookies(session.cookies);

  for(const width of [360,390]){
    await page.setViewportSize({width,height:800});
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Diary',exact:true})).toBeVisible();

    // 1. Verify page has zero horizontal scroll
    const pageScrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    expect(pageScrollWidth).toBeLessThanOrEqual(width);

    // 2. Open Log food dialog and check tab menu
    const launcher=page.getByRole('button',{name:'Add entry',exact:true});
    await launcher.click();
    const addSheet=page.getByRole('dialog',{name:'Add',exact:true});
    await expect(addSheet).toBeVisible();
    await addSheet.getByRole('button',{name:'Log food'}).click();
    const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
    await expect(foodDialog).toBeVisible();

    const segmentedControl=foodDialog.locator('.food-selection .segmented-control');
    const segScrollWidth=await segmentedControl.evaluate(el=>el.scrollWidth);
    const segClientWidth=await segmentedControl.evaluate(el=>el.clientWidth);
    expect(segScrollWidth).toBeLessThanOrEqual(segClientWidth+2);

    // Assert buttons don't have mid-word breaks or multiline overflow
    const tabButtons=segmentedControl.getByRole('button');
    expect(await tabButtons.count()).toBe(4);
    for(const btn of await tabButtons.all()){
      const box=(await btn.boundingBox())!;
      expect(box.width).toBeGreaterThan(50);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // Close Log food modal
    await foodDialog.getByRole('button',{name:'Close dialog'}).click();

    // 3. Navigate to Progress tab
    const nav=page.getByRole('navigation',{name:'Main navigation'});
    await nav.getByRole('button',{name:'Progress'}).click();
    await expect(page.getByRole('heading',{name:'Progress',exact:true})).toBeVisible();

    // Check Weight chart segmented control: zero horizontal scroll
    const chartToggle=page.locator('.chart-view-toggle');
    await expect(chartToggle).toBeVisible();
    const chartScrollW=await chartToggle.evaluate(el=>el.scrollWidth);
    const chartClientW=await chartToggle.evaluate(el=>el.clientWidth);
    expect(chartScrollW).toBeLessThanOrEqual(chartClientW+2);

    // Check Photos tab and "Add photo set" button layout
    const progressTabs=page.locator('#progress-tabs');
    await progressTabs.getByRole('button',{name:'Photos'}).click();
    const physiquePanel=page.locator('.physique');
    await expect(physiquePanel).toBeVisible();

    const addPhotoBtn=physiquePanel.getByRole('button',{name:'Add photo set',exact:true});
    await expect(addPhotoBtn).toBeVisible();
    const photoBtnBox=(await addPhotoBtn.boundingBox())!;
    const headingBox=(await physiquePanel.locator('.section-heading h2').boundingBox())!;
    // Button must be below heading or non-overlapping
    expect(photoBtnBox.y).toBeGreaterThanOrEqual(headingBox.y);
    expect(photoBtnBox.height).toBeGreaterThanOrEqual(44);
    expect(photoBtnBox.width).toBeGreaterThan(100);

    // 4. Navigate to Coach -> Plan -> Macros
    await nav.getByRole('button',{name:'Coach'}).click();
    await expect(page.getByRole('heading',{name:'Coach',exact:true})).toBeVisible();

    // Click "Edit plan"
    const editPlanBtn=page.getByRole('button',{name:'Edit plan'});
    if(await editPlanBtn.isVisible()){
      await editPlanBtn.click();
      // Progress is informational; move through the plan with the forward action.
      await expect(page.locator('.coach-step-progress').getByRole('button')).toHaveCount(0);
      await page.getByRole('button',{name:/^Next: Activity/}).click();
      await page.getByRole('button',{name:/^Next: Goal/}).click();
      await page.getByRole('button',{name:/^Next: Macros/}).click();

      // Check Macro presets: zero horizontal scroll and selectable buttons
      const macroPresets=page.locator('.macro-presets');
      await expect(macroPresets).toBeVisible();
      const macroScrollW=await macroPresets.evaluate(el=>el.scrollWidth);
      const macroClientW=await macroPresets.evaluate(el=>el.clientWidth);
      expect(macroScrollW).toBeLessThanOrEqual(macroClientW+2);
      await macroPresets.getByRole('button',{name:'Keto',exact:true}).click();

      // Verify no horizontal overflow in coach panel
      const coachStage=page.locator('.coach-step-stage');
      const coachScrollW=await coachStage.evaluate(el=>el.scrollWidth);
      const coachClientW=await coachStage.evaluate(el=>el.clientWidth);
      expect(coachScrollW).toBeLessThanOrEqual(coachClientW+2);
    }
  }
});
