import {describe,expect,it} from 'vitest';
import {checkInDue,weekStart} from './checkIn';
import type {AppState} from '../types';

const state=(extra:Partial<AppState>={}):Pick<AppState,'plans'|'profileRevision'|'checkIns'>=>({
  plans:[{id:'plan',revision:4,deleted:false,date:'2026-09-01',inputRevision:3,profileRevision:3,resultJson:'{}'}],
  profileRevision:3,checkIns:[],...extra
});

describe('Monday check-ins',()=>{
  it('uses Monday as the week boundary',()=>{
    expect(weekStart('2026-09-06')).toBe('2026-08-31');
    expect(weekStart('2026-09-07')).toBe('2026-09-07');
  });
  it('is due on a later Monday and after a profile edit',()=>{
    expect(checkInDue(state(),'2026-09-07')).toBe(true);
    expect(checkInDue(state({profileRevision:4}),'2026-09-02')).toBe(true);
  });
  it('hides a declined week until the following Monday',()=>{
    const checkIns=[{id:'decline',revision:5,deleted:false,weekStart:'2026-09-07',date:'2026-09-08',decision:'declined',inputRevision:4,resultJson:'{}'}];
    expect(checkInDue(state({checkIns}),'2026-09-08')).toBe(false);
    expect(checkInDue(state({checkIns}),'2026-09-14')).toBe(true);
  });
});
