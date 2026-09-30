import {expect,test} from 'vitest';
import {shareOfMaintenance,stepsForCalories} from './stepCalories';

test('steps follow body weight and height-based step length',()=>{
  // 80 kg burns 40 kcal per km above rest; 300 kcal is 7.5 km; a 180 cm man steps 0.747 m.
  const estimate=stepsForCalories({targetKcal:300,weightKg:80,heightCm:180,sex:'male'})!;
  expect(estimate.distanceKm).toBeCloseTo(7.5,5);
  expect(estimate.stepLengthM).toBeCloseTo(0.747,3);
  expect(estimate.steps).toBe(10040);
  expect(estimate.minutes).toBe(100);
  expect(estimate.kcalPerThousandSteps).toBeCloseTo(29.9,1);
});

test('a heavier person needs fewer steps for the same energy',()=>{
  const lighter=stepsForCalories({targetKcal:300,weightKg:60,heightCm:170,sex:'female'})!;
  const heavier=stepsForCalories({targetKcal:300,weightKg:90,heightCm:170,sex:'female'})!;
  expect(heavier.steps).toBeLessThan(lighter.steps);
});

test('an unknown sex uses the average step ratio rather than refusing',()=>{
  const estimate=stepsForCalories({targetKcal:200,weightKg:70,heightCm:175,sex:null})!;
  expect(estimate.stepLengthM).toBeCloseTo(1.75*0.414,5);
});

test('missing weight, height, or a non-positive target gives no estimate',()=>{
  expect(stepsForCalories({targetKcal:300,weightKg:null,heightCm:180,sex:'male'})).toBeNull();
  expect(stepsForCalories({targetKcal:300,weightKg:80,heightCm:0,sex:'male'})).toBeNull();
  expect(stepsForCalories({targetKcal:0,weightKg:80,heightCm:180,sex:'male'})).toBeNull();
  expect(stepsForCalories({targetKcal:Number.NaN,weightKg:80,heightCm:180,sex:'male'})).toBeNull();
});

test('maintenance share stays unknown without an estimate',()=>{
  expect(shareOfMaintenance(300,2500)).toBeCloseTo(0.12,5);
  expect(shareOfMaintenance(300,null)).toBeNull();
});
