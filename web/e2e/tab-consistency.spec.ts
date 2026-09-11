import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};

test('tab switching preserves consistent button locations and modal coordinates',async({page,request})=>{
  await request.post('/api/auth/dev-reset',{headers});
  const credentials={username:'tab-consistency-user',password:'nutrition test 2026'};
  const res=await request.post('/api/auth/register',{headers,data:credentials});
  expect(res.ok()).toBeTruthy();
  const state=await (await request.get('/api/state')).json();
  const save=async(kind:string,data:unknown,recordId=randomUUID())=>{
    await request.post('/api/sync',{headers,data:{id:randomUUID(),kind,recordId,expectedRevision:0,delete:false,data}});
  };
  await save('profile',{dateOfBirth:'1996-03-14',age:30,heightCm:170,weightKg:81,sex:'female',activity:1.4,goal:'maintain',maintenance:2500,timeZone:'Asia/Kuala_Lumpur',phaseMode:'open',energyAdjustmentPercent:0},state.id);
  const preview=await (await request.get('/api/coach/preview')).json();
  await request.post('/api/coach/accept',{headers,data:{id:randomUUID(),revision:preview.revision}});

  const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(let i=0;i<6;i++){
    await save('entry',{date:current,name:`Food item ${i}`,calories:200+i*50,protein:20,carbs:30,fat:10,quantity:100,unit:'g',time:'08:00'});
    await save('food',{name:`Saved food ${i}`,calories:200+i*50,protein:20,carbs:30,fat:10,servingGrams:100,favourite:i%2===0,source:'custom'});
  }

  const session=await request.storageState();
  await page.context().addCookies(session.cookies);

  // 1. Desktop: LogFood modal consistency
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');

  const launcher=page.getByRole('button',{name:'Add entry',exact:true});
  await launcher.click();
  const addDialog=page.getByRole('dialog',{name:'Add',exact:true});
  await addDialog.getByRole('button',{name:'Log food'}).click();
  const foodDialog=page.getByRole('dialog',{name:'Log food',exact:true});
  await expect(foodDialog).toBeVisible();

  const surface=page.locator('.food-modal .modal-surface');
  const tabs=['Search','Your foods','Barcode','AI logging'] as const;
  const segmentedControl=foodDialog.locator('.segmented-control');

  const measurements:Array<{tab:string;surfaceY:number;surfaceH:number;quickAddX:number;quickAddY:number;tabBtnY:number}>=[];

  for(const tabName of tabs){
    const tabBtn=segmentedControl.getByRole('button',{name:tabName,exact:true});
    await tabBtn.click();
    await page.waitForTimeout(100);

    const surfaceBox=(await surface.boundingBox())!;
    const quickAddBox=(await foodDialog.getByRole('button',{name:'Quick add',exact:true}).boundingBox())!;
    const tabBtnBox=(await tabBtn.boundingBox())!;

    measurements.push({
      tab:tabName,
      surfaceY:surfaceBox.y,
      surfaceH:surfaceBox.height,
      quickAddX:quickAddBox.x,
      quickAddY:quickAddBox.y,
      tabBtnY:tabBtnBox.y,
    });
  }

  // Verify that across all 4 tabs, modal position, height, and toolbar/tab button Y stay completely consistent
  const initial=measurements[0];
  for(const m of measurements){
    expect(Math.abs(m.surfaceY-initial.surfaceY)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.surfaceH-initial.surfaceH)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.quickAddY-initial.quickAddY)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.quickAddX-initial.quickAddX)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.tabBtnY-initial.tabBtnY)).toBeLessThanOrEqual(1);
  }

  // Close food dialog
  await page.keyboard.press('Escape');

  // 2. Progress page tabs consistency on mobile
  await page.setViewportSize({width:390,height:800});
  await page.getByRole('button',{name:'Progress',exact:true}).click();
  await page.waitForTimeout(400);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(50);
  const progressTabs=['Weight','Energy','Photos'] as const;
  const pMeasurements:number[]=[];

  for(const pTab of progressTabs){
    const tabBtn=page.getByRole('button',{name:pTab,exact:true});
    await tabBtn.click();
    await page.waitForTimeout(100);
    const box=(await tabBtn.boundingBox())!;
    pMeasurements.push(box.y);
  }

  // All 3 tabs must remain at the exact same Y coordinate on mobile
  for(const y of pMeasurements){
    expect(Math.abs(y-pMeasurements[0])).toBeLessThanOrEqual(1);
  }
});
