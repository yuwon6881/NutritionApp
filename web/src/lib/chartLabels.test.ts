import {describe,expect,it} from 'vitest';
import {bucketAxisLabel,bucketReadoutLabel,dateSpan} from './chartLabels';

describe('chart date labels',()=>{
  it('labels bars by grouping',()=>{
    expect(bucketAxisLabel('2026-09-29','daily')).toEqual(['Tue','29']);
    expect(bucketAxisLabel('2026-09-21','weekly')).toEqual(['Sep 21','']);
    expect(bucketAxisLabel('2026-09-01','monthly')).toEqual(['Sep','2026']);
  });

  it('spells out a bucket for the readout',()=>{
    expect(bucketReadoutLabel('2026-09-29','2026-09-29','daily')).toBe('Tue, Sep 29, 2026');
    expect(bucketReadoutLabel('2026-09-21','2026-09-27','weekly')).toBe('Sep 21 – 27, 2026');
    expect(bucketReadoutLabel('2026-09-01','2026-09-30','monthly')).toBe('Sep 2026');
  });

  it('keeps date spans short without losing the year',()=>{
    expect(dateSpan('2026-09-28','2026-10-04')).toBe('Sep 28 – Oct 4, 2026');
    expect(dateSpan('2025-12-29','2026-01-04')).toBe('Dec 29, 2025 – Jan 4, 2026');
    expect(dateSpan('2026-09-29','2026-09-29')).toBe('Sep 29, 2026');
  });
});
