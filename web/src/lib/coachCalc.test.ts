import {describe,it,expect} from 'vitest';
import {calculateResting,estimateExpenditure,calculateLivePace} from './coachCalc';

describe('coachCalc', ()=>{
  it('calculates resting energy expenditure according to Mifflin-St Jeor', ()=>{
    // Male: 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    const maleResting = calculateResting({age:30,heightCm:180,weightKg:80,sex:'male'});
    expect(maleResting).toBe(1780);

    // Female: 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161 = 1330.25
    const femaleResting = calculateResting({age:28,heightCm:165,weightKg:60,sex:'female'});
    expect(femaleResting).toBe(1330.25);
  });

  it('calculates live pace targets with safety floors and 25 kcal rounding', ()=>{
    const profile = {
      age: 30,
      heightCm: 170,
      weightKg: 81,
      sex: 'female' as const,
      activity: 1.4,
      goal: 'lose' as const,
      maintenance: 2500,
      proteinGrams: null,
      resistanceTraining: false,
      pregnancyOrBreastfeeding: false,
      medicalNutrition: false,
      timeZone: 'Asia/Kuala_Lumpur',
      phaseMode: 'open' as const,
      durationWeeks: 8,
      phaseStart: null,
      targetWeightKg: null,
      phaseStartWeightKg: null,
      energyAdjustmentPercent: 20
    };

    const pace = calculateLivePace(profile, 20);
    // Expenditure is 2500 (from maintenance)
    expect(pace.expenditure).toBe(2500);
    // 20% deficit of 2500 is 500 kcal deficit -> 2000 kcal target
    expect(pace.target).toBe(2000);
    expect(pace.change).toBe(-500);
  });
});
