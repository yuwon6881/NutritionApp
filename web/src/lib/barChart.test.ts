import {describe,expect,it} from 'vitest';
import {barSlotWidth,dateAxisOffsets,dateAxisStep,niceStep,niceTicks,revealScrollLeft,steppedPath,visibleBarCount,visibleRange} from './barChart';

describe('scrollable bar chart geometry',()=>{
  it('shows fewer bars on narrower window tiers',()=>{
    expect(visibleBarCount('compact')).toBeLessThan(visibleBarCount('medium'));
    expect(visibleBarCount('medium')).toBeLessThan(visibleBarCount('expanded'));
  });

  it('fills the viewport when the series is short and scrolls when it is long',()=>{
    expect(barSlotWidth(350,5,7)).toBe(70);
    expect(barSlotWidth(350,30,7)).toBe(50);
    expect(barSlotWidth(0,30,7)).toBe(0);
    expect(barSlotWidth(350,0,7)).toBe(350);
  });

  it('scrolls only as far as needed to reveal a slot',()=>{
    expect(revealScrollLeft(3,50,100,200)).toBeNull();
    expect(revealScrollLeft(1,50,100,200)).toBe(50);
    expect(revealScrollLeft(8,50,100,200)).toBe(250);
    expect(revealScrollLeft(-1,50,100,200)).toBeNull();
  });

  it('names the first and last visible slots',()=>{
    expect(visibleRange(0,350,50,30)).toEqual({first:0,last:6});
    expect(visibleRange(1150,350,50,30)).toEqual({first:23,last:29});
    expect(visibleRange(0,350,70,5)).toEqual({first:0,last:4});
  });
});

describe('axis ticks',()=>{
  it('uses round steps',()=>{
    expect(niceStep(3000,4)).toBe(1000);
    expect(niceStep(2.3,4)).toBe(1);
    expect(niceStep(9,4)).toBe(2.5);
  });

  it('covers the data range with round values',()=>{
    expect(niceTicks(0,2740,4)).toEqual([0,1000,2000,3000]);
    expect(niceTicks(79.3,81.6,4)).toEqual([79,80,81,82]);
    expect(niceTicks(80.2,80.9,4)).toEqual([80.2,80.4,80.6,80.8,81]);
    expect(niceTicks(80,80)).toEqual([79,80,81]);
  });
});

describe('stepped maintenance line',()=>{
  it('runs flat across each slot and breaks at unknown values',()=>{
    const path=steppedPath([2000,2000,null,2100],10,value=>value/100);
    expect(path).toBe('M0 20 H10 V20 H20 M30 21 H40');
  });

  it('draws nothing when every value is unknown',()=>{
    expect(steppedPath([null,null],10,value=>value)).toBe('');
  });
});

describe('date axis labels',()=>{
  it('labels every day when each day is wide, and thins out as days narrow',()=>{
    expect(dateAxisStep(150)).toBe(1);
    expect(dateAxisStep(40)).toBe(2);
    expect(dateAxisStep(20)).toBe(7);
    expect(dateAxisStep(4)).toBe(28);
    expect(dateAxisStep(0)).toBe(365);
  });

  it('places labels on whole days from the first day, never repeating one',()=>{
    expect(dateAxisOffsets(4,150)).toEqual([0,1,2,3,4]);
    expect(dateAxisOffsets(10,40)).toEqual([0,2,4,6,8,10]);
    expect(dateAxisOffsets(0,150)).toEqual([0]);
  });

  it('adds the last day only when it clears the previous label',()=>{
    expect(dateAxisOffsets(30,20)).toEqual([0,7,14,21,28]);
    expect(dateAxisOffsets(31,20)).toEqual([0,7,14,21,28]);
    expect(dateAxisOffsets(34,20)).toEqual([0,7,14,21,28,34]);
  });
});
