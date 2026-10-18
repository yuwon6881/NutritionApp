import {describe,expect,it} from 'vitest';
import {releaseVelocity,settlesOpen,swipeOffset} from './swipeReveal';

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

  it('opens on a quick left flick that covered little distance',()=>{
    expect(settlesOpen(-40,180,-.8)).toBe(true);
  });

  it('closes on a quick right flick even from far open',()=>{
    expect(settlesOpen(-150,180,.8)).toBe(false);
  });

  it('measures speed over the last moments before release only',()=>{
    const samples=[{x:300,t:0},{x:298,t:200},{x:260,t:240},{x:220,t:280}];
    expect(releaseVelocity(samples,290)).toBeCloseTo(-.975,3);
    expect(releaseVelocity([{x:10,t:5}],10)).toBe(0);
    expect(releaseVelocity([],10)).toBe(0);
  });

  it('keeps a flick from sparse moves fast when the finger lifts right after',()=>{
    // Moves about 45 ms apart, as a busy phone delivers them; the release follows the last move.
    const samples=[{x:344,t:0},{x:326,t:32},{x:306,t:80},{x:286,t:125}];
    expect(settlesOpen(-58,204,releaseVelocity(samples,157))).toBe(true);
  });

  it('reads a finger held still before release as no flick',()=>{
    const samples=[{x:300,t:0},{x:250,t:30},{x:200,t:60}];
    expect(releaseVelocity(samples,300)).toBe(0);
  });
});
