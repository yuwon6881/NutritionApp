import {describe,expect,it} from 'vitest';
import type {Weight} from '../types';
import {parseWeight} from './units';
import {unusualWeightDifference,weightContextOptionsFor} from './weightContext';

const weights=(values:Array<[string,number,string?]>):Weight[]=>values.map(([date,kg,id=date])=>({
  id,revision:1,deleted:false,date,kg,
}));

describe('unusual weigh-in detection',()=>{
  const history=weights([
    ['2026-09-01',80],['2026-09-05',80.2],['2026-09-10',79.9],
  ]);

  it('detects high and low entries using the recent median',()=>{
    expect(unusualWeightDifference('82','kg','2026-09-11',history)?.medianKg).toBe(80);
    expect(unusualWeightDifference('78','kg','2026-09-11',history)?.differenceKg).toBe(2);
  });

  it('uses kilograms for equivalent pound input',()=>{
    const pounds=(80+2)*2.2046226218;
    const result=unusualWeightDifference(String(pounds),'lb','2026-09-11',history);

    expect(result?.differenceKg).toBeCloseTo(2,8);
    expect(parseWeight(String(pounds),'lb')).toBeCloseTo(82,8);
  });

  it('does not prompt with fewer than three earlier weigh-ins',()=>{
    expect(unusualWeightDifference('82','kg','2026-09-11',history.slice(0,2))).toBeNull();
  });

  it('uses earlier dates only and ignores entries older than fourteen days',()=>{
    const values=weights([
      ['2026-08-26',70],['2026-08-28',70],['2026-08-29',70],
      ['2026-09-01',80],['2026-09-05',80],['2026-09-10',80],['2026-09-12',70],
    ]);

    expect(unusualWeightDifference('82','kg','2026-09-11',values)?.medianKg).toBe(80);
  });

  it('excludes the edited record from its baseline and applies the strict threshold',()=>{
    const values=[...history,{id:'edited',revision:2,deleted:false,date:'2026-09-11',kg:82}];

    expect(unusualWeightDifference('82','kg','2026-09-11',values,'edited')).not.toBeNull();
    expect(unusualWeightDifference('81.19','kg','2026-09-11',history)).toBeNull();
  });

  it('carries a clear recent trend forward instead of comparing with a lagging median',()=>{
    // Fourteen daily weigh-ins losing 0.2 kg a day end at 80.2 kg; the median sits near 81.5 kg.
    const date=(index:number)=>new Date(Date.UTC(2026,7,28)+index*86400000).toISOString().slice(0,10);
    const cut=weights(Array.from({length:14},(_,index):[string,number]=>[date(index),82.8-.2*index]));

    const expectedToday=unusualWeightDifference('80','kg','2026-09-11',cut);
    const hiddenSpike=unusualWeightDifference('81.4','kg','2026-09-11',cut);

    expect(expectedToday).toBeNull();
    expect(hiddenSpike?.direction).toBe('up');
    expect(hiddenSpike?.expectedKg).toBeCloseTo(80,6);
  });

  it('reports whether the entry is a spike or a drop',()=>{
    expect(unusualWeightDifference('82','kg','2026-09-11',history)?.direction).toBe('up');
    expect(unusualWeightDifference('78','kg','2026-09-11',history)?.direction).toBe('down');
  });
});

describe('direction-aware context options',()=>{
  it('offers retention causes for a spike and depletion causes for a drop',()=>{
    const spike=weightContextOptionsFor('up').map(option=>option.value);
    const drop=weightContextOptionsFor('down').map(option=>option.value);

    expect(spike).toContain('high_sodium');
    expect(spike).not.toContain('dehydration');
    expect(drop).toContain('dehydration');
    expect(drop).not.toContain('high_sodium');
    for(const neutral of ['illness','genuine_change','unsure'] as const){
      expect(spike).toContain(neutral);
      expect(drop).toContain(neutral);
    }
  });
});
