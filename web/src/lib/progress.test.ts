import {describe,expect,it} from 'vitest';
import {progressPeriodOptions,progressRange} from './progress';

describe('progress periods',()=>{
  it('keeps all five selectors aligned and defaults to the calendar month',()=>{
    expect(progressPeriodOptions.map(option=>option.label)).toEqual(['Last week','Last month','Last 6 months','One year','All']);
    expect(progressRange('month','2026-03-31')).toEqual({start:'2026-03-01',end:'2026-03-31'});
    expect(progressRange('week','2026-03-31')).toEqual({start:'2026-03-25',end:'2026-03-31'});
  });

  it('uses the profile-local end date and the earliest retained record for All',()=>{
    expect(progressRange('six-months','2026-03-31')).toEqual({start:'2025-10-01',end:'2026-03-31'});
    expect(progressRange('year','2026-03-31')).toEqual({start:'2025-04-01',end:'2026-03-31'});
    expect(progressRange('all','2026-03-31','1990-01-01')).toEqual({start:'2000-01-01',end:'2026-03-31'});
  });
});
