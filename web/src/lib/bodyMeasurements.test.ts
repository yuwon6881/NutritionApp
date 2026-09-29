import {describe,expect,it} from 'vitest';
import {allMeasurementKeys,clampIndex,measurementLabel,stepRecordId,toCentimetres} from './bodyMeasurements';

describe('body measurement vocabulary',()=>{
  it('lists every circumference before body fat and labels each key',()=>{
    expect(allMeasurementKeys).toHaveLength(14);
    expect(allMeasurementKeys.at(-1)).toBe('bodyFatPercent');
    expect(allMeasurementKeys.every(key=>measurementLabel(key).length>0)).toBe(true);
  });

  it('keeps a viewer index inside a list that shrank',()=>{
    expect(clampIndex(3,2)).toBe(1);
    expect(clampIndex(-1,2)).toBe(0);
    expect(clampIndex(4,0)).toBe(0);
  });

  it('steps between newest-first records and stops at either end',()=>{
    const ids=['newest','middle','oldest'];
    expect(stepRecordId(ids,'middle','older')).toBe('oldest');
    expect(stepRecordId(ids,'middle','newer')).toBe('newest');
    expect(stepRecordId(ids,'oldest','older')).toBeNull();
    expect(stepRecordId(ids,'newest','newer')).toBeNull();
    expect(stepRecordId(ids,'missing','older')).toBeNull();
  });

  it('stores circumferences in centimetres at one decimal',()=>{
    expect(toCentimetres(32,'in')).toBe(81.3);
    expect(toCentimetres(81.26,'cm')).toBe(81.3);
  });
});
