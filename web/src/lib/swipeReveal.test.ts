import {describe,expect,it} from 'vitest';
import {settlesOpen,swipeOffset} from './swipeReveal';

describe('swipe reveal',()=>{
  it('follows the finger left and never past the actions or to the right',()=>{
    expect(swipeOffset(-40,false,180)).toBe(-40);
    expect(swipeOffset(-400,false,180)).toBe(-180);
    expect(swipeOffset(60,false,180)).toBe(0);
  });

  it('starts from fully open when the row was already revealed',()=>{
    expect(swipeOffset(50,true,180)).toBe(-130);
  });

  it('settles open only past half of the reveal width',()=>{
    expect(settlesOpen(-89,180)).toBe(false);
    expect(settlesOpen(-90,180)).toBe(true);
  });
});
