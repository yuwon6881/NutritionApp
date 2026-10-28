import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {TargetWeeklySummary} from './TargetWeeklySummary';
import type {CoachResult,UnitPreferences} from '../../types';

const defaultUnits: UnitPreferences = {
  energy: 'kcal',
  weight: 'kg',
  height: 'cm'
};

const baseResult: CoachResult = {
  eligible: true,
  adaptive: true,
  version: '1.0',
  calories: 2200,
  protein: 150,
  carbs: 250,
  fat: 65,
  expenditure: 2500,
  explanation: 'Balanced plan',
  weeklyCalories: 15400,
  dailyCalories: [2200, 2200, 2200, 2200, 2200, 2200, 2200]
};

describe('TargetWeeklySummary', () => {
  it('collapses identical daily targets to one line with Show each day button', () => {
    const html = renderToStaticMarkup(createElement(TargetWeeklySummary, {
      result: baseResult,
      units: defaultUnits
    }));

    expect(html).toContain('2,200 kcal every day');
    expect(html).toContain('Show each day');
    expect(html).toContain('aria-expanded="false"');
    // Collapsed: seven chips should not be rendered
    expect(html).not.toContain('weekly-day-chip');
  });

  it('shows chips directly when daily values differ', () => {
    const variedResult: CoachResult = {
      ...baseResult,
      dailyCalories: [2000, 2000, 2000, 2000, 2000, 2700, 2700]
    };
    const html = renderToStaticMarkup(createElement(TargetWeeklySummary, {
      result: variedResult,
      units: defaultUnits
    }));

    expect(html).not.toContain('every day');
    expect(html).not.toContain('Show each day');
    expect(html).toContain('weekly-day-chip');
    expect(html).toContain('Mon');
    expect(html).toContain('Sat');
  });

  it('formats energy with kJ when energy unit is kj', () => {
    const kjUnits: UnitPreferences = {...defaultUnits, energy: 'kj'};
    const html = renderToStaticMarkup(createElement(TargetWeeklySummary, {
      result: baseResult,
      units: kjUnits
    }));

    expect(html).toContain('kJ every day');
  });
});
