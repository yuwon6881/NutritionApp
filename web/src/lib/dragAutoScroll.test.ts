import {describe,expect,it} from 'vitest';
import {AUTO_SCROLL_EDGE_PX,AUTO_SCROLL_MAX_PX,autoScrollStep} from './dragAutoScroll';

const band={top:60,bottom:800};

describe('drag auto-scroll',()=>{
  it('stays still away from the edges',()=>{
    expect(autoScrollStep(400,band)).toBe(0);
    expect(autoScrollStep(band.top+AUTO_SCROLL_EDGE_PX,band)).toBe(0);
    expect(autoScrollStep(band.bottom-AUTO_SCROLL_EDGE_PX,band)).toBe(0);
  });

  it('scrolls up near the top and down near the bottom',()=>{
    expect(autoScrollStep(band.top+10,band)).toBeLessThan(0);
    expect(autoScrollStep(band.bottom-10,band)).toBeGreaterThan(0);
  });

  it('speeds up deeper into the edge and caps past it',()=>{
    const shallow=autoScrollStep(band.bottom-AUTO_SCROLL_EDGE_PX+10,band);
    const deep=autoScrollStep(band.bottom-5,band);
    expect(deep).toBeGreaterThan(shallow);
    // Over the bottom navigation the card still scrolls, at full speed.
    expect(autoScrollStep(band.bottom+40,band)).toBe(AUTO_SCROLL_MAX_PX);
    expect(autoScrollStep(0,band)).toBe(-AUTO_SCROLL_MAX_PX);
  });

  it('shrinks the edge zone on short viewports so the middle stays still',()=>{
    const short={top:0,bottom:200};
    expect(autoScrollStep(100,short)).toBe(0);
    expect(autoScrollStep(60,short)).toBe(0);
    expect(autoScrollStep(10,short)).toBeLessThan(0);
  });

  it('never scrolls without a usable band',()=>{
    expect(autoScrollStep(10,{top:300,bottom:300})).toBe(0);
  });
});
