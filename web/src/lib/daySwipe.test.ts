import {describe,expect,it} from 'vitest';
import {dragDirection,lockAxis,startsOutsideEdge,swipeOutcome,swipeTranslate} from './daySwipe';

describe('day swipe',()=>{
  it('locks to the horizontal axis only for a clearly sideways move',()=>{
    expect(lockAxis(4,3)).toBe('pending');
    expect(lockAxis(24,6)).toBe('horizontal');
    expect(lockAxis(20,18)).toBe('vertical');
    expect(lockAxis(2,30)).toBe('vertical');
  });

  it('maps dragging left to the next day and right to the previous day',()=>{
    expect(dragDirection(-30)).toBe(1);
    expect(dragDirection(30)).toBe(-1);
    expect(dragDirection(0)).toBe(0);
  });

  it('commits after a long drag or a quick flick, and settles back otherwise',()=>{
    expect(swipeOutcome(-80,600,true,true)).toBe(1);
    expect(swipeOutcome(80,600,true,true)).toBe(-1);
    expect(swipeOutcome(-30,60,true,true)).toBe(1);
    expect(swipeOutcome(-30,600,true,true)).toBe(0);
    expect(swipeOutcome(-10,20,true,true)).toBe(0);
  });

  it('does not open a day that does not exist',()=>{
    expect(swipeOutcome(-120,200,true,false)).toBe(0);
    expect(swipeOutcome(120,200,false,true)).toBe(0);
  });

  it('follows the finger where a day exists and resists where it does not',()=>{
    expect(swipeTranslate(-100,true,true)).toBe(-100);
    expect(swipeTranslate(-100,true,false)).toBe(-25);
    expect(swipeTranslate(100,false,true)).toBe(25);
  });

  it('leaves the screen edges to the system back gesture',()=>{
    expect(startsOutsideEdge(8,390)).toBe(false);
    expect(startsOutsideEdge(200,390)).toBe(true);
    expect(startsOutsideEdge(384,390)).toBe(false);
  });
});
