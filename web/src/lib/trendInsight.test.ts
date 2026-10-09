import {describe,expect,it} from 'vitest';
import {sparklinePaths,trendInsight} from './trendInsight';

describe('trend insight',()=>{
  it('is unknown without trend points',()=>{
    expect(trendInsight([])).toBeNull();
  });

  it('measures change from the last point at least a week earlier',()=>{
    const insight=trendInsight([
      {date:'2026-09-01',kg:82},
      {date:'2026-09-02',kg:81.8},
      {date:'2026-09-05',kg:81.5},
      {date:'2026-09-09',kg:81.1},
    ])!;
    expect(insight.latest).toEqual({date:'2026-09-09',kg:81.1});
    expect(insight.change?.since).toBe('2026-09-02');
    expect(insight.change?.kg).toBeCloseTo(-.7);
    expect(insight.recent).toHaveLength(4);
  });

  it('leaves change unknown when the nearest earlier point is over a fortnight old',()=>{
    expect(trendInsight([{date:'2026-08-01',kg:82},{date:'2026-09-09',kg:81}])!.change).toBeNull();
    expect(trendInsight([{date:'2026-09-05',kg:82},{date:'2026-09-09',kg:81}])!.change).toBeNull();
  });

  it('keeps only the last thirty days for the sparkline',()=>{
    const insight=trendInsight([{date:'2026-07-01',kg:83},{date:'2026-08-10',kg:82},{date:'2026-09-09',kg:81}])!;
    expect(insight.recent.map(point=>point.date)).toEqual(['2026-08-10','2026-09-09']);
  });
});

describe('sparkline paths',()=>{
  it('needs two points',()=>{
    expect(sparklinePaths([{date:'2026-09-01',kg:80}],100,30)).toBeNull();
  });

  it('spaces points by date and keeps the highest weight at the top',()=>{
    const paths=sparklinePaths([{date:'2026-09-01',kg:82},{date:'2026-09-02',kg:81},{date:'2026-09-05',kg:80}],100,30)!;
    expect(paths.line).toBe('M0.0 3.0 L25.0 15.0 L100.0 27.0');
    expect(paths.area).toBe('M0.0 3.0 L25.0 15.0 L100.0 27.0 L100 30 L0 30 Z');
  });

  it('draws a flat series at mid-height',()=>{
    expect(sparklinePaths([{date:'2026-09-01',kg:80},{date:'2026-09-03',kg:80}],100,30)!.line).toBe('M0.0 15.0 L100.0 15.0');
  });
});
