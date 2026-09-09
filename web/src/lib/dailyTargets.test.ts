import {describe,expect,it} from 'vitest';
import {allocateWeeklyCalories,dailyCalories,mondayIndex,normaliseDistribution,scaledMacros,weeklyCalories} from './dailyTargets';

describe('daily targets',()=>{
  it('conserves the weekly budget and allocates remainders by stable index',()=>{
    const targets=allocateWeeklyCalories(14001,[0,0,0,0,0,0,100]);
    expect(targets).toEqual([0,0,0,0,0,0,14001]);
    expect(targets.reduce((sum,value)=>sum+value,0)).toBe(14001);
    expect(allocateWeeklyCalories(100,[1,1,1,1,1,1,1])).toEqual([15,15,14,14,14,14,14]);
  });

  it('normalises non-negative shares but rejects malformed distributions',()=>{
    expect(normaliseDistribution([1,1,1,1,1,1,1])?.reduce((sum,value)=>sum+value,0)).toBeCloseTo(100);
    expect(normaliseDistribution([1,2])).toBeNull();
    expect(normaliseDistribution([1,-1,1,1,1,1,1])).toBeNull();
  });

  it('looks up a Monday-first target for every date',()=>{
    expect(mondayIndex('2026-09-07')).toBe(0);
    const result={calories:2000,weeklyCalories:14000,dailyCalories:[1900,1950,2000,2050,2100,2000,2000],protein:150,carbs:200,fat:70};
    expect(dailyCalories(result,'2026-09-13')).toBe(2000);
    expect(weeklyCalories(result)).toBe(14000);
  });

  it('scales one shared macro split with each accepted day',()=>{
    expect(scaledMacros({calories:2000,protein:150,carbs:200,fat:70},1900)).toEqual({protein:142.5,carbs:190,fat:66.5});
    expect(dailyCalories({calories:2000,weeklyCalories:null,dailyCalories:null},'2026-09-07')).toBe(2000);
  });
});
