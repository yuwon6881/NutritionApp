import {describe,expect,it} from 'vitest';
import {changeSincePrevious} from './weighInList';

const series=[{date:'2026-09-20',scaleKg:81,trendKg:81},{date:'2026-09-22',scaleKg:80.6,trendKg:80.9},{date:'2026-09-25',scaleKg:80.9,trendKg:80.8}];

describe('weigh-in change',()=>{
  it('compares with the closest earlier weigh-in',()=>{
    expect(changeSincePrevious(series,'2026-09-25',80.9)).toBeCloseTo(.3);
    expect(changeSincePrevious(series,'2026-09-23',80.2)).toBeCloseTo(-.4);
  });

  it('is unknown for the first weigh-in in the period',()=>{
    expect(changeSincePrevious(series,'2026-09-20',81)).toBeNull();
    expect(changeSincePrevious([],'2026-09-20',81)).toBeNull();
  });
});
