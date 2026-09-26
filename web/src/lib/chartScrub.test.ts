import {describe,expect,it} from 'vitest';
import {nearestIndex,steppedIndex} from './chartScrub';

describe('chart scrubbing',()=>{
  it('picks the nearest point to the finger',()=>{
    expect(nearestIndex([10,50,90],62)).toBe(1);
    expect(nearestIndex([10,50,90],200)).toBe(2);
    expect(nearestIndex([10,50,90],30)).toBe(0);
    expect(nearestIndex([],30)).toBe(-1);
  });

  it('steps with arrow keys within the series and ignores other keys',()=>{
    expect(steppedIndex(0,'ArrowLeft',3)).toBe(0);
    expect(steppedIndex(1,'ArrowRight',3)).toBe(2);
    expect(steppedIndex(2,'ArrowRight',3)).toBe(2);
    expect(steppedIndex(1,'Home',3)).toBe(0);
    expect(steppedIndex(0,'End',3)).toBe(2);
    expect(steppedIndex(1,'Enter',3)).toBeNull();
    expect(steppedIndex(0,'ArrowRight',0)).toBeNull();
  });
});
