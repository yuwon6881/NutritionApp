import {describe,expect,it} from 'vitest';
import type {Entry} from '../types';
import {daySummaryText} from './share';

const entry=(name:string,calories:number,protein:number|null):Entry=>({id:name,revision:1,deleted:false,date:'2026-09-26',name,calories,protein,carbs:10,fat:2,fiber:null,source:'Manual',quantity:1,unit:'serving'} as Entry);

describe('day summary sharing',()=>{
  it('lists the day total and each food',()=>{
    const text=daySummaryText('2026-09-26',[entry('Oats',410,12),entry('Tea',5,0)],'kcal');
    expect(text.split('\n')[0]).toBe('Food log for 2026-09-26: 415 kcal');
    expect(text).toContain('Protein 12 g · Carbs 20 g · Fat 4 g');
    expect(text).toContain('• Oats');
  });

  it('says a macro is unknown instead of counting a missing value as zero',()=>{
    expect(daySummaryText('2026-09-26',[entry('Oats',410,12),entry('Soup',120,null)],'kcal')).toContain('Protein unknown');
  });
});
