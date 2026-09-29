import {describe,expect,it} from 'vitest';
import {easeOutCubic} from './useIntroProgress';

describe('easeOutCubic',()=>{
  it('starts at zero, settles at one, and never overshoots',()=>{
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
  it('front-loads movement so the ring reaches most of its value early',()=>{
    expect(easeOutCubic(.5)).toBeCloseTo(.875);
    for(let step=0;step<10;step++)expect(easeOutCubic((step+1)/10)).toBeGreaterThan(easeOutCubic(step/10));
  });
});
