import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {signIn} from './signIn';

const origin=process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088';
const headers={Origin:origin,'X-Nutrition-Request':'1'};

test('canceling Workout consent returns to Settings and a retry starts cleanly',async({page})=>{
  await signIn(page,'test-alice');
  const state=await (await page.request.get('/api/state')).json();
  if(!state.profile){
    const profile=await page.request.post('/api/sync',{headers,data:{
      id:randomUUID(),
      recordId:state.id,
      kind:'profile',
      expectedRevision:state.profileRevision,
      delete:false,
      data:{
        dateOfBirth:'1996-03-14',
        age:30,
        heightCm:170,
        weightKg:81,
        sex:'female',
        activity:1.4,
        goal:'maintain',
        maintenance:2500,
        timeZone:'Asia/Kuala_Lumpur',
        phaseMode:'open',
        energyAdjustmentPercent:0,
      },
    }});
    expect(profile.ok(),await profile.text()).toBeTruthy();
  }
  await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Connect Workout',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Fitness Account consent',exact:true})).toBeVisible();
  const firstAuthorizeUrl=new URL(page.url());
  expect(firstAuthorizeUrl.searchParams.get('prompt')).toBe('consent');
  expect(firstAuthorizeUrl.searchParams.getAll('error')).toEqual([]);

  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('Workout connection was canceled.',{exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll('error')).toEqual([]);
  expect(new URL(page.url()).searchParams.getAll('central_error')).toEqual([]);

  await page.getByRole('button',{name:'Connect Workout',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Fitness Account consent',exact:true})).toBeVisible();
  const retryAuthorizeUrl=new URL(page.url());
  expect(retryAuthorizeUrl.searchParams.get('prompt')).toBe('consent');
  expect(retryAuthorizeUrl.searchParams.getAll('error')).toEqual([]);
  expect(retryAuthorizeUrl.searchParams.getAll('central_error')).toEqual([]);
});
