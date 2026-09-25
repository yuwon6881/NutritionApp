import {describe,expect,it} from 'vitest';
import {windowTier} from './breakpoints';

describe('window tiers',()=>{
  it('matches the compact, medium, and expanded CSS boundaries',()=>{
    expect(windowTier(360)).toBe('compact');
    expect(windowTier(639)).toBe('compact');
    expect(windowTier(640)).toBe('medium');
    expect(windowTier(1023)).toBe('medium');
    expect(windowTier(1024)).toBe('expanded');
  });
});
