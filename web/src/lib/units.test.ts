import {describe,expect,it} from 'vitest';
import {cmFromHeightParts,displayEnergy,displayHeight,displayWeight,heightPartsFromCm,inputEnergy,inputWeight,parseEnergy,parseWeight,unitsFor} from './units';

describe('display units',()=>{
  it('defaults old or incomplete settings to metric',()=>{
    expect(unitsFor()).toEqual({weight:'kg',energy:'kcal',height:'cm'});
    expect(unitsFor({weightUnit:'unknown' as never,energyUnit:'unknown' as never,heightUnit:'unknown' as never})).toEqual({weight:'kg',energy:'kcal',height:'cm'});
  });
  it('converts weight and energy inputs back to canonical values',()=>{
    expect(displayWeight(80,'lb',1)).toBe('176.4');
    expect(parseWeight(inputWeight(80,'lb',1),'lb')).toBeCloseTo(80,1);
    expect(displayEnergy(2000,'kj')).toBe('8,368');
    expect(parseEnergy(inputEnergy(2000,'kj'),'kj')).toBeCloseTo(2000,0);
  });
  it('converts feet and inches without changing stored centimetres',()=>{
    const parts=heightPartsFromCm(170);
    expect(parts.feet).toBe(5);expect(parts.inches).toBe(6.9);
    expect(cmFromHeightParts(String(parts.feet),String(parts.inches))).toBeCloseTo(170,0);
    expect(displayHeight(170,'ft-in')).toBe('5 ft 6.9 in');
  });
});
