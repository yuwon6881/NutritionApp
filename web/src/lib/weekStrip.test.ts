import {describe,expect,it} from 'vitest';
import {swipedDate,weekStripDays} from './weekStrip';

describe('food log week strip',()=>{
  it('shows the Monday-to-Sunday week of the selected date and disables days after today',()=>{
    const days=weekStripDays('2026-09-24','2026-09-26');
    expect(days.map(day=>day.date)).toEqual(['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26','2026-09-27']);
    expect(days[0]).toMatchObject({weekday:'Mon',dayOfMonth:21,future:false});
    expect(days[6]).toMatchObject({weekday:'Sun',future:true});
  });

  it('keeps a Sunday in the week that ends on it',()=>{
    expect(weekStripDays('2026-09-27','2026-09-30')[0].date).toBe('2026-09-21');
  });

  it('moves one day per swipe without passing today or the first diary date',()=>{
    expect(swipedDate('2026-09-24',1,'2026-09-26')).toBe('2026-09-25');
    expect(swipedDate('2026-09-26',1,'2026-09-26')).toBe('2026-09-26');
    expect(swipedDate('2000-01-01',-1,'2026-09-26')).toBe('2000-01-01');
  });
});
