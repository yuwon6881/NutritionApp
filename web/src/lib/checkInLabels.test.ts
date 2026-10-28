import {describe,expect,it} from 'vitest';
import {confirmLabel} from './checkInLabels';

describe('confirmLabel',()=>{
  it('returns Keep label with energy unit when calories are unchanged',()=>{
    expect(confirmLabel({changed:false,calories:2500,unit:'kcal'})).toBe('Keep 2,500 kcal');
    expect(confirmLabel({changed:false,calories:2500,unit:'kj'})).toBe('Keep 10,460 kJ');
  });

  it('preserves defaultLabel when calories have changed',()=>{
    expect(confirmLabel({changed:true,calories:2500,unit:'kcal'})).toBe('Accept');
    expect(confirmLabel({changed:true,calories:2500,unit:'kcal',defaultLabel:'Accept new target'})).toBe('Accept new target');
    expect(confirmLabel({changed:true,calories:2200,unit:'kcal',defaultLabel:'Confirm'})).toBe('Confirm');
  });

  it('falls back to defaultLabel when calories are missing or invalid',()=>{
    expect(confirmLabel({changed:false,calories:null,unit:'kcal'})).toBe('Accept');
    expect(confirmLabel({changed:false,calories:undefined,unit:'kcal'})).toBe('Accept');
    expect(confirmLabel({changed:false,calories:NaN,unit:'kcal',defaultLabel:'Custom'})).toBe('Custom');
  });
});
