import {describe,it,expect} from 'vitest';
import {calculateResting,calculateLivePace,getPaceStatus} from './coachCalc';

const base={
  age:30,
  dateOfBirth:null as string|null,
  heightCm:170,
  weightKg:81,
  sex:'female' as const,
  activity:1.4,
  goal:'lose' as const,
  maintenance:2500 as number|null,
  proteinGrams:null,
  resistanceTraining:false,
  pregnancyOrBreastfeeding:false,
  medicalNutrition:false,
  timeZone:'Asia/Kuala_Lumpur',
  phaseMode:'open' as const,
  durationWeeks:8,
  phaseStart:null,
  targetWeightKg:null,
  phaseStartWeightKg:null,
  energyAdjustmentPercent:20,
};

describe('coachCalc', ()=>{
  it('calculates resting energy expenditure according to Mifflin-St Jeor', ()=>{
    // Male: 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(calculateResting({age:30,heightCm:180,weightKg:80,sex:'male'})).toBe(1780);
    // Female: 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161 = 1330.25
    expect(calculateResting({age:28,heightCm:165,weightKg:60,sex:'female'})).toBe(1330.25);
  });

  it('calculates live pace targets with safety floors and 25 kcal rounding', ()=>{
    const pace=calculateLivePace(base,20);
    expect(pace.expenditure).toBe(2500);
    expect(pace.target).toBe(2000);
    expect(pace.change).toBe(-500);
  });

  it('derives age from a stored date of birth so the equation follows the calendar', ()=>{
    const shared={...base,age:0,goal:'maintain' as const,maintenance:null,energyAdjustmentPercent:0};
    const young=calculateLivePace({...shared,dateOfBirth:'1996-01-01'},undefined,undefined,'2026-01-01');
    const older=calculateLivePace({...shared,dateOfBirth:'1986-01-01'},undefined,undefined,'2026-01-01');
    expect(young.resting-older.resting).toBe(50);
  });

  it('uses a stored macro split instead of the coach default', ()=>{
    const pace=calculateLivePace({...base,goal:'maintain',maintenance:2000,energyAdjustmentPercent:0,
      proteinPercent:25,carbsPercent:5,fatPercent:70});
    expect(pace.target).toBe(2000);
    expect(pace.protein).toBe(125);
    expect(pace.carbs).toBe(25);
    expect(pace.fat).toBe(155.6);
    expect(pace.split).toEqual({protein:25,carbs:5,fat:70});
  });

  it('calculates explicit slider pace directly without 25% hard clamp', ()=>{
    const pace=calculateLivePace({...base,weightKg:65,maintenance:2263,goal:'lose',goalRatePercent:-0.95});
    expect(pace.expenditure).toBe(2263);
    expect(pace.target).toBe(1575);
    expect(pace.isFloored).toBe(false);
    expect(pace.rawChange).toBe(-679);

    const steeper=calculateLivePace({...base,weightKg:65,maintenance:2263,goal:'lose',goalRatePercent:-1.0});
    expect(steeper.target).toBe(1550);
  });

  it('preserves conservative safety floors when no explicit pace rate is set', ()=>{
    const floored=calculateLivePace({...base,maintenance:2000,goal:'lose',goalRatePercent:null,energyAdjustmentPercent:30});
    expect(floored.expenditure).toBe(2000);
    expect(floored.target).toBe(1500);
    expect(floored.isFloored).toBe(true);
    expect(floored.change).toBe(-500);
  });

  it('determines pace status and contextual feedback for loss and gain', ()=>{
    expect(getPaceStatus('lose', -0.3, false, 'kcal', 2263, 2050).tone).toBe('gentle');
    expect(getPaceStatus('lose', -0.75, false, 'kcal', 2263, 1725).tone).toBe('recommended');
    expect(getPaceStatus('lose', -1.2, false, 'kcal', 2263, 1400).tone).toBe('aggressive');

    expect(getPaceStatus('gain', 0.05, false).tone).toBe('gentle');
    expect(getPaceStatus('gain', 0.15, false).tone).toBe('recommended');
    expect(getPaceStatus('gain', 0.4, false).tone).toBe('aggressive');
  });
});
