import {describe,expect,it} from 'vitest';
import {isKeyboardOpen,KEYBOARD_MIN_HEIGHT_PX} from './virtualKeyboard';

describe('virtual keyboard detection',()=>{
  it('reports open only when a field is focused and the viewport lost a keyboard height',()=>{
    expect(isKeyboardOpen(800,480,true)).toBe(true);
    expect(isKeyboardOpen(800,800-KEYBOARD_MIN_HEIGHT_PX,true)).toBe(true);
  });

  it('ignores browser toolbar collapse and other small resizes',()=>{
    expect(isKeyboardOpen(800,744,true)).toBe(false);
  });

  it('never reports open without an editable focus, whatever the viewport does',()=>{
    expect(isKeyboardOpen(800,400,false)).toBe(false);
  });
});
