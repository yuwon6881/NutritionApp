import {expect,it} from 'vitest';
import {validateFoodDestination} from './foodDestination';
import {today} from './format';
import {shiftDate} from './energyBalance';
import type {AppState} from '../types';
it('allows tomorrow planning and rejects later or archived destinations before persistence',()=>{
  const state={profile:null,days:[],entries:[],detailDays:90} as unknown as AppState;
  const day=today();const op={kind:'entry' as const,recordId:'e',expectedRevision:0,delete:false,data:{date:shiftDate(day,1)}};
  expect(()=>validateFoodDestination(state,op)).not.toThrow();
  expect(()=>validateFoodDestination(state,{...op,data:{date:shiftDate(day,2)}})).toThrow('tomorrow');
  expect(()=>validateFoodDestination({...state,days:[{id:'d',date:day,status:'complete',revision:1,deleted:false,archived:true}]},{...op,data:{date:day}})).toThrow('read-only');
});
