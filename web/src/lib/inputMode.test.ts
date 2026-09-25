import {describe,expect,it} from 'vitest';
import {numericInputMode} from './inputMode';

describe('numeric input mode',()=>{
  it('offers the decimal key for fractional or unrestricted steps',()=>{
    expect(numericInputMode({type:'number',step:'0.1'})).toBe('decimal');
    expect(numericInputMode({type:'number',step:'any'})).toBe('decimal');
    expect(numericInputMode({type:'number',step:0.01})).toBe('decimal');
  });

  it('offers a digits pad for whole-number steps',()=>{
    expect(numericInputMode({type:'number'})).toBe('numeric');
    expect(numericInputMode({type:'number',step:'1'})).toBe('numeric');
    expect(numericInputMode({type:'number',step:5})).toBe('numeric');
  });

  it('leaves non-numeric fields alone',()=>{
    expect(numericInputMode({type:'text',step:'0.1'})).toBeUndefined();
    expect(numericInputMode({})).toBeUndefined();
  });
});
