import {expect,it} from 'vitest';
import type {AppState} from '../types';
import {progressDataKey} from './progressFreshness';

it('ignores unrelated account revisions but invalidates acknowledged diary and trend changes',()=>{
  const state={revision:1,profileRevision:2,diaryRevision:3,trajectoryRevision:4,plans:[]} as unknown as AppState;
  const key=progressDataKey(state);
  expect(progressDataKey({...state,revision:20,foodRevision:20})).toBe(key);
  expect(progressDataKey({...state,diaryRevision:5})).not.toBe(key);
  expect(progressDataKey({...state,trajectoryRevision:5})).not.toBe(key);
  expect(progressDataKey({...state,diaryRevision:undefined})).toBe('1');
});
