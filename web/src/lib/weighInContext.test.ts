import {describe,expect,it} from 'vitest';
import {stepWeight,weighInContext,weightBounds} from './weighInContext';

describe('weighInContext', () => {
  it('returns empty string when there is no previous weigh-in', () => {
    expect(weighInContext(null,'2026-10-29','kg')).toBe('');
    expect(weighInContext(undefined,'2026-10-29','kg')).toBe('');
    expect(weighInContext(null,'2026-10-29','kg',82.7)).toBe('');
  });

  it('formats context when weigh-in was today', () => {
    const last={date:'2026-10-29',kg:82.9};
    expect(weighInContext(last,'2026-10-29','kg')).toBe('Last weigh-in 82.9 kg · today');
  });

  it('formats context when weigh-in was yesterday', () => {
    const last={date:'2026-10-28',kg:82.9};
    expect(weighInContext(last,'2026-10-29','kg')).toBe('Last weigh-in 82.9 kg · yesterday');
  });

  it('formats context for 5 days ago', () => {
    const last={date:'2026-10-24',kg:82.9};
    expect(weighInContext(last,'2026-10-29','kg')).toBe('Last weigh-in 82.9 kg · 5 days ago');
  });

  it('formats context for older than 14 days using shortDate', () => {
    const last={date:'2026-10-09',kg:82.9};
    expect(weighInContext(last,'2026-10-29','kg')).toBe('Last weigh-in 82.9 kg · Oct 9');
  });

  it('formats context with and without trend', () => {
    const last={date:'2026-10-26',kg:82.9};
    expect(weighInContext(last,'2026-10-29','kg')).toBe('Last weigh-in 82.9 kg · 3 days ago');
    expect(weighInContext(last,'2026-10-29','kg',82.7)).toBe('Last weigh-in 82.9 kg · 3 days ago · Trend 82.7 kg');
  });

  it('formats context with lb unit and trend', () => {
    const last={date:'2026-10-26',kg:82.9};
    expect(weighInContext(last,'2026-10-29','lb',82.7)).toBe('Last weigh-in 182.8 lb · 3 days ago · Trend 182.3 lb');
  });
});

describe('stepWeight', () => {
  it('steps weight up and down by 0.1 in kg', () => {
    expect(stepWeight('82.9','up','kg')).toBe('83.0');
    expect(stepWeight('82.9','down','kg')).toBe('82.8');
    expect(stepWeight('80.0','down','kg')).toBe('79.9');
    expect(stepWeight('79.9','up','kg')).toBe('80.0');
  });

  it('avoids floating point noise on decimal increments and decrements', () => {
    expect(stepWeight('82.7','down','kg')).toBe('82.6');
    expect(stepWeight('82.2','up','kg')).toBe('82.3');
  });

  it('starts from the last weigh-in value when input is empty', () => {
    expect(stepWeight('','up','kg',82.9)).toBe('83.0');
    expect(stepWeight('','down','kg',82.9)).toBe('82.8');
    expect(stepWeight('  ','up','kg',80)).toBe('80.1');
  });

  it('does nothing when input is empty and no last weigh-in is available', () => {
    expect(stepWeight('','up','kg')).toBe('');
    expect(stepWeight('','down','kg',null)).toBe('');
    expect(stepWeight('','up','kg',undefined)).toBe('');
  });

  it('clamps at minimum and maximum bounds for kg', () => {
    expect(stepWeight('20.0','down','kg')).toBe('20.0');
    expect(stepWeight('19.9','down','kg')).toBe('20.0');
    expect(stepWeight('400.0','up','kg')).toBe('400.0');
    expect(stepWeight('400.1','up','kg')).toBe('400.0');
  });

  it('clamps at minimum and maximum bounds for lb', () => {
    expect(stepWeight('44.1','down','lb')).toBe('44.1');
    expect(stepWeight('44.0','down','lb')).toBe('44.1');
    expect(stepWeight('881.8','up','lb')).toBe('881.8');
    expect(stepWeight('882.0','up','lb')).toBe('881.8');
  });

  it('steps in lb unit correctly', () => {
    expect(stepWeight('150.0','up','lb')).toBe('150.1');
    expect(stepWeight('150.0','down','lb')).toBe('149.9');
    // 80 kg * 2.2046226218 = 176.3698... -> rounded to 1 decimal is 176.4 lb
    expect(stepWeight('','up','lb',80)).toBe('176.5');
    expect(stepWeight('','down','lb',80)).toBe('176.3');
  });
});

describe('weightBounds', () => {
  it('returns appropriate bounds per unit', () => {
    expect(weightBounds('kg')).toEqual({min:20,max:400});
    expect(weightBounds('lb')).toEqual({min:44.1,max:881.8});
  });
});
