import {describe,expect,it} from 'vitest';
import type {AppState} from '../types';
import {bootstrapNeedsRefresh,type NutritionRevisions} from './revisions';

const state={revision:7} as AppState;
const revisions={account:7,profile:0,settings:0,trajectory:0,foods:0,diary:0,body:0,training:0,google:0,localDay:'',detailDays:90} satisfies NutritionRevisions;

describe('bootstrap revision coordination',()=>{
  it('refreshes when an account-level mutation changes coaching state',()=>{
    expect(bootstrapNeedsRefresh(state,{...revisions,account:8})).toBe(true);
  });
});
