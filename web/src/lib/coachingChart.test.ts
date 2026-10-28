import {describe,expect,it} from 'vitest';
import {acceptedLineSpan,filterPointsToRange} from './coachingChart';

describe('acceptedLineSpan',()=>{
  it('keeps normal interval unchanged',()=>{
    expect(acceptedLineSpan(50,150,20)).toEqual([50,150]);
    expect(acceptedLineSpan(25,30,20)).toEqual([25,30]);
  });

  it('draws a stub ending at x2 when length is zero',()=>{
    expect(acceptedLineSpan(100,100,20)).toEqual([72,100]);
    expect(acceptedLineSpan(200,200,50)).toEqual([172,200]);
  });

  it('clamps stub at left edge when near or beyond left',()=>{
    expect(acceptedLineSpan(30,30,20)).toEqual([20,30]);
    expect(acceptedLineSpan(20,20,20)).toEqual([20,20]);
    expect(acceptedLineSpan(10,10,20)).toEqual([20,10]);
  });

  it('supports custom stub width',()=>{
    expect(acceptedLineSpan(100,100,20,40)).toEqual([60,100]);
    expect(acceptedLineSpan(35,35,20,40)).toEqual([20,35]);
  });
});

describe('filterPointsToRange',()=>{
  const points=[
    {date:'2026-03-01',val:1},
    {date:'2026-03-10',val:2},
    {date:'2026-03-20',val:3},
    {date:'2026-03-31',val:4},
  ];

  it('keeps all points when no range is given',()=>{
    expect(filterPointsToRange(points)).toEqual(points);
  });

  it('filters inclusive of start and end dates',()=>{
    expect(filterPointsToRange(points,'2026-03-10','2026-03-20')).toEqual([
      {date:'2026-03-10',val:2},
      {date:'2026-03-20',val:3},
    ]);
  });

  it('filters with start only',()=>{
    expect(filterPointsToRange(points,'2026-03-20')).toEqual([
      {date:'2026-03-20',val:3},
      {date:'2026-03-31',val:4},
    ]);
  });

  it('filters with end only',()=>{
    expect(filterPointsToRange(points,undefined,'2026-03-10')).toEqual([
      {date:'2026-03-01',val:1},
      {date:'2026-03-10',val:2},
    ]);
  });

  it('returns empty when no points fall within range',()=>{
    expect(filterPointsToRange(points,'2026-04-01','2026-04-30')).toEqual([]);
  });
});
