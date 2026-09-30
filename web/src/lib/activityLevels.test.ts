import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {activityFields,activityLevelInfo,activityLevels,closestActivityLevel} from './activityLevels';

describe('activity levels',()=>{
  it('match the server multipliers and lifting protein',()=>{
    const source=readFileSync(new URL('../../../api/Domain/ActivityLevels.cs',import.meta.url),'utf8');
    const keys=[...source.matchAll(/public const string \w+ = "([a-z_]+)";/g)].map(match=>match[1]);
    expect([...activityLevels].sort()).toEqual([...keys].sort());
    expect(activityFields('none')).toEqual({activity:1.3,resistanceTraining:false});
    expect(activityFields('lifting')).toEqual({activity:1.5,resistanceTraining:true});
    expect(activityFields('cardio')).toEqual({activity:1.6,resistanceTraining:false});
    expect(activityFields('cardio_lifting')).toEqual({activity:1.75,resistanceTraining:true});
  });

  it('suggests the closest choice for a profile saved before them',()=>{
    expect(closestActivityLevel({activity:1.4,resistanceTraining:false})).toBe('none');
    expect(closestActivityLevel({activity:1.8,resistanceTraining:false})).toBe('cardio');
    expect(closestActivityLevel({activity:1.4,resistanceTraining:true})).toBe('lifting');
    expect(closestActivityLevel({activity:2,resistanceTraining:true})).toBe('cardio_lifting');
    expect(closestActivityLevel({activity:0,resistanceTraining:false})).toBeNull();
    expect(activityLevelInfo('cardio_lifting').label).toBe('Cardio & Lifting');
  });
});
