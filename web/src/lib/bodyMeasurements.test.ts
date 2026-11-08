import {describe,expect,it} from 'vitest';
import {allMeasurementKeys,clampIndex,measurementLabel,stepRecordId,toCentimetres,circumferenceUnitFor,fromCentimetres} from './bodyMeasurements';

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

  it('shows circumferences in inches for pounds users and converts from the exact stored value',()=>{
    expect(circumferenceUnitFor('lb')).toBe('in');
    expect(circumferenceUnitFor('kg')).toBe('cm');
    expect(fromCentimetres(70,'cm')).toBe(70);
    expect(fromCentimetres(70.1,'in')).toBeCloseTo(27.598,3);
    // Flipping units from the exact value never drifts: 70.0 cm stays 70.0 cm.
    expect(Math.round(fromCentimetres(70,'in')*10)/10).toBe(27.6);
    expect(toCentimetres(fromCentimetres(70,'in'),'in')).toBe(70);
  });
});
