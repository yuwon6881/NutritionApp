import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {FoodTimeCard,type FoodTimeCardProps} from './FoodTimeCard';
import type {Entry} from '../types';

const entry={id:'e1',name:'Banana',calories:105,protein:1,carbs:27,fat:0,grams:118,measure:'g',date:'2026-11-16'} as unknown as Entry;

function render(overrides:Partial<FoodTimeCardProps>){
  return renderToStaticMarkup(createElement(FoodTimeCard,{
    entry,energyUnit:'kcal',isSelecting:false,isSelected:false,isMoved:false,isPendingSync:false,
    onToggleSelect:()=>undefined,dragProps:{},...overrides,
  } as FoodTimeCardProps));
}

describe('FoodTimeCard sync indicator',()=>{
  it('shows a still indicator for queued work that is not being sent (offline or between retries)',()=>{
    const html=render({isPendingSync:true,isSending:false});
    expect(html).toContain('Pending sync');
    expect(html).not.toContain('sync-label-spinner');
  });

  it('spins only while the queue is actively sending',()=>{
    const html=render({isPendingSync:true,isSending:true});
    expect(html).toContain('sync-label-spinner');
    expect(html).toContain('Pending sync');
  });

  it('shows nothing once the entry is acknowledged',()=>{
    const html=render({isPendingSync:false,isSending:true});
    expect(html).not.toContain('sync-label');
  });
});
