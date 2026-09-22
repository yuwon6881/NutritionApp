import {describe,expect,it} from 'vitest';
import type {Weight} from '../types';
import {parseWeight} from './units';
import {unusualWeightDifference} from './weightContext';

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
});
