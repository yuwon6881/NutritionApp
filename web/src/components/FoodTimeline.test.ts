import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FoodTimeline} from './FoodTimeline';
import type {Entry} from '../types';
import type {NutritionStore} from '../useNutritionStore';

const entry=(id:string,name:string)=>({id,name,calories:100,protein:1,carbs:1,fat:1,grams:100,measure:'g',date:'2026-11-16',time:'08:00'}) as unknown as Entry;
const entries=[entry('e1','Banana'),entry('e2','Oats')];

function render(sendingRecordId:string|undefined,queuedIds:string[]){
  const store={
    state:{settings:{}},
    sendingRecordId,
    sync:{phase:'syncing',kind:'photo'},
    local:{queue:queuedIds.map(recordId=>({id:`op-${recordId}`,kind:'entry',recordId}))},
  } as unknown as NutritionStore;
  return renderToStaticMarkup(createElement(FoodTimeline,{
    store,date:'2026-11-16',currentDate:'2026-11-16',entries,onEdit:()=>undefined,onMove:()=>undefined,
  }));
}

const spinners=(html:string)=>html.split('sync-label-spinner').length-1;
const labels=(html:string)=>html.split('class="sync-label"').length-1;

describe('FoodTimeline sync indicators',()=>{
  beforeEach(()=>{vi.stubGlobal('navigator',{onLine:true});});
  afterEach(()=>{vi.unstubAllGlobals();});

  it('spins only the entry in flight, not other queued entries or unrelated photo/body syncs',()=>{
    const html=render('e1',['e1','e2']);
    expect(labels(html)).toBe(2);
    expect(spinners(html)).toBe(1);
  });

  it('keeps every queued entry still when nothing is being sent',()=>{
    const html=render(undefined,['e1','e2']);
    expect(labels(html)).toBe(2);
    expect(spinners(html)).toBe(0);
  });

  it('keeps queued entries still while offline',()=>{
    vi.stubGlobal('navigator',{onLine:false});
    expect(spinners(render('e1',['e1','e2']))).toBe(0);
  });

  it('shows no indicator once the entry is acknowledged',()=>{
    expect(labels(render(undefined,[]))).toBe(0);
  });
});
