import {describe,expect,it} from 'vitest';
import {numberFieldText} from './numberFieldText';

describe('number field text',()=>{
  it('keeps the typed text while a converted value is echoed back',()=>{
    // 83 kJ is stored as 20 kcal and comes back as "84" kJ.
    expect(numberFieldText('83','84',true)).toBe('83');
    // An emptied calories field is stored as 0 but stays empty while typing continues.
    expect(numberFieldText('','0',true)).toBe('');
  });

  it('follows the stored value once typing ends, keeping equivalent unfinished text',()=>{
    expect(numberFieldText('83','84',false)).toBe('84');
    expect(numberFieldText('1.',1,false)).toBe('1.');
    expect(numberFieldText('1.5',2,false)).toBe('2');
    expect(numberFieldText('','0',false)).toBe('');
    expect(numberFieldText('12','',false)).toBe('');
    expect(numberFieldText('12',null,false)).toBe('');
  });
});
