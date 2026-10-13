import {expect,type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';

/** Complete setup for fixtures representing an existing user, preserving any accepted plan. */
export async function ensureAcceptedPlan(request:APIRequestContext){
  const state=await (await request.get('/api/state')).json();
  if(state.plans.some((plan:{deleted:boolean})=>!plan.deleted))return;
  const previewResponse=await request.get('/api/coach/preview');
  expect(previewResponse.ok(),await previewResponse.text()).toBeTruthy();
  const preview=await previewResponse.json();
  const accepted=await request.post('/api/coach/accept',{
    headers:{Origin:process.env.NUTRITION_TEST_URL??'http://127.0.0.1:5088','X-Nutrition-Request':'1'},
    data:{id:randomUUID(),revision:preview.revision}
  });
  expect(accepted.ok(),await accepted.text()).toBeTruthy();
}
