import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FoodDaySummary, type DayTargets } from './FoodDaySummary';
import type { Entry } from '../types';

describe('FoodDaySummary', () => {
  const baseTargets: DayTargets = {
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65,
  };

  const makeEntry = (date: string, calories: number, protein: number, carbs: number, fat: number): Entry => ({
    id: '1',
    revision: 1,
    deleted: false,
    name: 'Meal',
    calories,
    protein,
    carbs,
    fat,
    fiber: null,
    source: 'test',
    date,
    quantity: 1,
    unit: 'serving',
  });

  it('renders target and remaining calories when check-in is not due', () => {
    const html = renderToStaticMarkup(createElement(FoodDaySummary, {
      title: 'Wednesday, Oct 28',
      statusText: 'Still logging',
      entries: [makeEntry('2026-10-28', 300, 20, 2, 22)],
      day: undefined,
      count: 1,
      fasting: false,
      total: 300,
      targets: baseTargets,
      energyUnit: 'kcal',
      isPastDay: false,
      checkInDue: false,
      date: '2026-10-28',
      currentDate: '2026-10-28',
    }));

    expect(html).toContain('of 2,000');
    expect(html).toContain('1,700 left');
    expect(html).toContain('aria-label="Calories logged against target"');
    expect(html).not.toContain('Target appears after your check-in');
  });

  it('hides calorie target and shows notice when check-in is due on today or future', () => {
    const html = renderToStaticMarkup(createElement(FoodDaySummary, {
      title: 'Wednesday, Oct 28',
      statusText: 'Still logging',
      entries: [makeEntry('2026-10-28', 300, 20, 2, 22)],
      day: undefined,
      count: 1,
      fasting: false,
      total: 300,
      targets: baseTargets,
      energyUnit: 'kcal',
      isPastDay: false,
      checkInDue: true,
      date: '2026-10-28',
      currentDate: '2026-10-28',
    }));

    expect(html).toContain('Target appears after your check-in');
    expect(html).not.toContain('of 2,000');
    expect(html).not.toContain('1,700 left');
    expect(html).not.toContain('aria-label="Calories logged against target"');
    // Macro targets still remain visible
    expect(html).toContain('/ 150 g');
    expect(html).toContain('/ 200 g');
    expect(html).toContain('/ 65 g');
  });

  it('keeps normal calorie targets on past days even when check-in is due', () => {
    const html = renderToStaticMarkup(createElement(FoodDaySummary, {
      title: 'Tuesday, Oct 27',
      statusText: 'Complete',
      entries: [makeEntry('2026-10-27', 1800, 140, 180, 60)],
      day: undefined,
      count: 1,
      fasting: false,
      total: 1800,
      targets: baseTargets,
      energyUnit: 'kcal',
      isPastDay: true,
      checkInDue: true,
      date: '2026-10-27',
      currentDate: '2026-10-28',
    }));

    expect(html).toContain('of 2,000');
    expect(html).toContain('200 left');
    expect(html).toContain('aria-label="Calories logged against target"');
    expect(html).not.toContain('Target appears after your check-in');
  });
});
