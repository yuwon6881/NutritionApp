import {describe,expect,it} from 'vitest';
import {allocateWeeklyCalories,adjustWeeklyCalories,dailyCalories,mondayIndex,normaliseDistribution,scaledMacros,weeklyCalories,weekendDistribution} from './dailyTargets';

describe('daily targets',()=>{
  it('conserves the weekly budget and allocates remainders by stable index',()=>{
    const targets=allocateWeeklyCalories(14001,[0,0,0,0,0,0,100]);
    expect(targets).toEqual([0,0,0,0,0,0,14001]);
    expect(targets.reduce((sum,value)=>sum+value,0)).toBe(14001);
    expect(allocateWeeklyCalories(100,[1,1,1,1,1,1,1])).toEqual([15,15,14,14,14,14,14]);
  });

  it('provides a 100% weekend-boost distribution with higher targets on Saturday and Sunday',()=>{
    const dist=weekendDistribution();
    expect(dist).toHaveLength(7);
    expect(dist.reduce((sum,v)=>sum+v,0)).toBe(100);
    expect(dist[5]).toBeGreaterThan(dist[0]);
    expect(dist[6]).toBeGreaterThan(dist[0]);
    const allocated=allocateWeeklyCalories(14000,dist);
    expect(allocated[0]).toBe(1750);
    expect(allocated[5]).toBe(2625);
    expect(allocated[6]).toBe(2625);
    expect(allocated.reduce((sum,v)=>sum+v,0)).toBe(14000);
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

  it('holds protein fixed when proteinFixed is true and adjusts carbs/fat',()=>{
    // 2000 kcal baseline: protein 160g (fixed), fat 66.7g, carbs 128.3g
    // On a 1500 kcal day, protein stays at 160g; remaining 860 kcal (vs 1360 ref) scales fat and carbs
    const result={calories:2000,protein:160,carbs:128.3,fat:66.7,proteinFixed:true};
    const scaled=scaledMacros(result,1500);
    expect(scaled.protein).toBe(160);
    // ratio = (1500 - 640) / (2000 - 640) = 860 / 1360 ≈ 0.6324
    expect(scaled.fat).toBeCloseTo(42.2,1);
    expect(scaled.carbs).toBeCloseTo(81.1,1);
  });

  it('scales all macros proportionally when proteinFixed is false',()=>{
    const result={calories:2000,protein:150,carbs:200,fat:70,proteinFixed:false};
    const scaled=scaledMacros(result,1900);
    expect(scaled).toEqual({protein:142.5,carbs:190,fat:66.5});
  });

  describe('adjustWeeklyCalories',()=>{
    it('adjusts one day and redistributes delta among unlocked days while keeping total exact',()=>{
      const budget=12250;
      const initial=[1750,1750,1750,1750,1750,1750,1750];
      const next=adjustWeeklyCalories(initial,budget,4,2050);
      expect(next[4]).toBe(2050);
      expect(next.reduce((sum,v)=>sum+v,0)).toBe(budget);
      // Other 6 days should each decrease by 50 to 1700
      expect(next[0]).toBe(1700);
      expect(next[1]).toBe(1700);
      expect(next[2]).toBe(1700);
      expect(next[3]).toBe(1700);
      expect(next[5]).toBe(1700);
      expect(next[6]).toBe(1700);
    });

    it('preserves locked days and only adjusts unlocked days',()=>{
      const budget=12250;
      const initial=[1700,1700,1700,1700,2050,1700,1700];
      const locked=[false,false,false,false,true,true,false]; // Fri and Sat locked
      const next=adjustWeeklyCalories(initial,budget,6,2200,locked); // change Sun to 2200
      expect(next[6]).toBe(2200);
      expect(next[4]).toBe(2050); // Fri locked
      expect(next[5]).toBe(1700); // Sat locked
      expect(next.reduce((sum,v)=>sum+v,0)).toBe(budget);
      // Remaining 4 unlocked days (0, 1, 2, 3) must absorb 500 increase (125 each -> 1575)
      expect(next[0]).toBe(1575);
      expect(next[1]).toBe(1575);
      expect(next[2]).toBe(1575);
      expect(next[3]).toBe(1575);
    });

    it('does not allow adjustments to a locked day',()=>{
      const budget=14000;
      const initial=[2000,2000,2000,2000,2000,2000,2000];
      const locked=[true,false,false,false,false,false,false];
      const next=adjustWeeklyCalories(initial,budget,0,2500,locked);
      expect(next).toEqual(initial);
    });

    it('clamps to 0 and available budget without going negative',()=>{
      const budget=7000;
      const initial=[1000,1000,1000,1000,1000,1000,1000];
      const locked=[true,false,false,false,false,false,false]; // Mon locked at 1000
      // Available budget is 6000. Try setting Tue to 8000.
      const next=adjustWeeklyCalories(initial,budget,1,8000,locked);
      expect(next[0]).toBe(1000); // locked
      expect(next[1]).toBe(6000); // clamped to 6000
      // All other unlocked days (2..6) become 0
      for(let i=2;i<7;i++)expect(next[i]).toBe(0);
      expect(next.reduce((sum,v)=>sum+v,0)).toBe(budget);
    });
  });
});
