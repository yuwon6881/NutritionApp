import {describe, expect, it} from 'vitest';
import {getWeeklyScheduleSubtitle} from './WeeklyScheduleReview';
import {allocateWeeklyCalories, equalDistribution, weekendDistribution} from '../../lib/dailyTargets';

describe('getWeeklyScheduleSubtitle', () => {
  it('returns Balanced daily targets for even schedules', () => {
    const evenValues = allocateWeeklyCalories(2100 * 7, equalDistribution());
    expect(getWeeklyScheduleSubtitle(evenValues)).toBe('Balanced daily targets');
    expect(getWeeklyScheduleSubtitle(evenValues, equalDistribution())).toBe('Balanced daily targets');
  });

  it('returns Higher on weekends when weekend distribution is used', () => {
    const weekendValues = allocateWeeklyCalories(2100 * 7, weekendDistribution());
    expect(getWeeklyScheduleSubtitle(weekendValues)).toBe('Higher on weekends');
    expect(getWeeklyScheduleSubtitle(weekendValues, weekendDistribution())).toBe('Higher on weekends');
  });

  it('recognises the weekend pattern whatever scale the shares are stored on', () => {
    const weekendValues = allocateWeeklyCalories(2100 * 7, weekendDistribution());
    expect(getWeeklyScheduleSubtitle(weekendValues, [2, 2, 2, 2, 2, 3, 3])).toBe('Higher on weekends');
  });

  it('returns Custom schedule for irregular schedules', () => {
    const customShares = [1, 1.2, 0.8, 1.4, 0.6, 1, 1];
    const customValues = allocateWeeklyCalories(2100 * 7, customShares);
    expect(getWeeklyScheduleSubtitle(customValues, customShares)).toBe('Custom schedule');
  });
});
