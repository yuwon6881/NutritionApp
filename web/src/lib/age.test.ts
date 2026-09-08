import {expect,test} from 'vitest';
import {ageOn} from './age';

test('age advances only after the birthday has passed',()=>{
  expect(ageOn('1996-09-10','2026-09-09')).toBe(29);
  expect(ageOn('1996-09-09','2026-09-09')).toBe(30);
  expect(ageOn('1996-12-01','2026-09-09')).toBe(29);
});
test('a missing or unparsable date of birth stays unknown',()=>{
  expect(ageOn(null,'2026-09-09')).toBeNull();
  expect(ageOn('','2026-09-09')).toBeNull();
  expect(ageOn('not-a-date','2026-09-09')).toBeNull();
});
