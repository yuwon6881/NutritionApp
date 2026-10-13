import {expect,it} from 'vitest';
import type {NutritionStore} from '../useNutritionStore';
import type {AppState,LocalData,Mutation} from '../types';
import {enqueueMutation,project} from '../lib/projection';
import {useSettingsSave} from './SettingsPreferences';

it('keeps all preference edits when handlers share an earlier render',async()=>{
  const state:AppState={
    id:'account',displayName:'Test',revision:1,profileRevision:0,profile:null,
    start:'2026-10-01',end:'2026-10-14',entries:[],foods:[],weights:[],days:[],plans:[],
    settings:{revision:4,checkInWeekday:1,weightUnit:'kg',energyUnit:'kcal',heightUnit:'cm'}
  };
  let retained:LocalData={state,queue:[]};
  const store={state,local:retained,mutate:async(operation:Omit<Mutation,'id'|'holdUntil'>)=>{
    retained=enqueueMutation(retained,{...operation,id:crypto.randomUUID()});
  }} as unknown as NutritionStore;
  // General and Diary settings both keep this render until durable writes finish.
  const general=useSettingsSave(store);
  const diary=useSettingsSave(store);
  await general.save({weightUnit:'lb'});
  await general.save({energyUnit:'kj'});
  await general.save({heightUnit:'ft-in'});
  await diary.save({checkInWeekday:5});
  expect(retained.queue).toHaveLength(1);
  expect(retained.queue[0].data).toEqual({
    weightUnit:'lb',energyUnit:'kj',heightUnit:'ft-in',checkInWeekday:5
  });
  expect(project(state,retained.queue).settings).toMatchObject({
    revision:4,weightUnit:'lb',energyUnit:'kj',heightUnit:'ft-in',checkInWeekday:5
  });
});
