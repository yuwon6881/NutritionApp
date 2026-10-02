import {afterEach,describe,expect,it,vi} from 'vitest';
import type {AppState,LocalData} from '../types';
import {bootstrapNeedsRefresh,pollNutritionRevisions,type NutritionRevisions} from './revisions';
import {apiWithMeta} from './api';

vi.mock('./api',()=>({apiWithMeta:vi.fn()}));
afterEach(()=>vi.unstubAllGlobals());

const state={revision:7} as AppState;
const revisions={account:7,profile:0,settings:0,trajectory:0,foods:0,diary:0,body:0,training:0,google:0,localDay:'',detailDays:90} satisfies NutritionRevisions;

describe('bootstrap revision coordination',()=>{
  it('refreshes when an account-level mutation changes coaching state',()=>{
    expect(bootstrapNeedsRefresh(state,{...revisions,account:8})).toBe(true);
  });
  it.each([false,true])('refreshes changed saved foods only after the library is requested (%s)',async foodsLoaded=>{
    vi.stubGlobal('navigator',{onLine:true});
    vi.mocked(apiWithMeta).mockResolvedValue({data:{...revisions,foods:2},etag:null,notModified:false});
    const loadFoods=vi.fn().mockResolvedValue(undefined);
    await pollNutritionRevisions('a',{current:{state:{...state,id:'a',foodRevision:1},queue:[],foodsLoaded} as LocalData},
      {current:undefined},{current:Date.now()},vi.fn().mockResolvedValue(undefined),loadFoods,vi.fn().mockResolvedValue(undefined));
    expect(loadFoods).toHaveBeenCalledTimes(foodsLoaded?1:0);
  });
});
