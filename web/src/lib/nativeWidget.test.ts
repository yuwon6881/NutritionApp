import { describe, expect, it } from 'vitest';
import type { AppState, Entry, Plan } from '../types';
import { buildWidgetSummaryPayload } from './nativeWidget';

function makeState(overrides: Partial<AppState> = {}): AppState {
  const plan = {
    id: 'plan-1',
    revision: 1,
    deleted: false,
    date: '2026-11-20',
    inputRevision: 1,
    profileRevision: 1,
    resultJson: JSON.stringify({
      eligible: true,
      adaptive: false,
      calories: 2000,
      expenditure: 2400,
      protein: 150,
      carbs: 200,
      fat: 65,
      explanation: '',
      version: '2.0.0',
    }),
  } as Plan;

  return {
    id: 'acc-1',
    displayName: 'Alex',
    revision: 1,
    profileRevision: 1,
    foods: [],
    profile: { timeZone: 'UTC' } as AppState['profile'],
    settings: {
      weightUnit: 'kg',
      energyUnit: 'kcal',
      heightUnit: 'cm',
      checkInWeekday: 1,
      coachingSettingsRevision: 1,
      missingDayAction: 'ask',
      weightGoalMetric: 'scale',
      revision: 1,
    },
    plans: [plan],
    entries: [],
    weights: [],
    days: [],
    phaseDecisions: [],
    start: '2026-11-01',
    end: '2026-11-30',
    ...overrides,
  } as AppState;
}

const entry = (calories: number, protein: number | null, carbs: number | null, fat: number | null, deleted = false): Entry => ({
  id: `${calories}-${deleted}`,
  revision: 1,
  deleted,
  date: '2026-11-27',
  time: '12:00',
  name: 'Meal',
  calories,
  protein,
  carbs,
  fat,
  fiber: 6,
  source: 'test',
  quantity: 1,
  unit: 'serving',
});

describe('buildWidgetSummaryPayload', () => {
  it('formats remaining calories and macro progress in kcal', () => {
    const state = makeState({
      entries: [entry(650, 45, 70, 20), entry(300, 20, 30, 10, true)],
    });
    expect(buildWidgetSummaryPayload(state, '2026-11-27')).toEqual({
      accountId: 'acc-1',
      date: '2026-11-27',
      caloriesText: '650 kcal',
      caloriesSubtext: 'of 2,000 kcal · 1,350 kcal left',
      macrosText: 'P 45/150g · C 70/200g · F 20/65g',
      timeZone: 'UTC',
    });
  });

  it('converts energy display to kJ and reports overage honestly', () => {
    const base = makeState({ entries: [entry(2500, 160, 250, 80)] });
    base.settings = { ...base.settings!, energyUnit: 'kj' };
    const summary = buildWidgetSummaryPayload(base, '2026-11-27');
    expect(summary.caloriesText).toContain('kJ');
    expect(summary.caloriesSubtext).toContain('over');
    expect(summary.macrosText).toBe('P 160/150g · C 250/200g · F 80/65g');
  });

  it('renders an honest state when no plan targets exist', () => {
    const summary = buildWidgetSummaryPayload(makeState({ plans: [] }), '2026-11-27');
    expect(summary.caloriesText).toBe('0 kcal');
    expect(summary.caloriesSubtext).toBe('Nothing logged yet');
    expect(summary.macrosText).toBe('P 0g · C 0g · F 0g');
  });

  it('keeps unknown macros unknown and marks partial totals instead of counting them as zero', () => {
    const unknown = buildWidgetSummaryPayload(makeState({ entries: [entry(400, null, 50, 10)] }), '2026-11-27');
    expect(unknown.macrosText).toBe('P —/150g · C 50/200g · F 10/65g');

    const partial = buildWidgetSummaryPayload(makeState({ entries: [entry(400, 30, 50, 10), { ...entry(200, null, 20, 5), id: 'b' }] }), '2026-11-27');
    expect(partial.macrosText).toBe('P ≥30/150g · C 70/200g · F 15/65g');

    const quickAdd = buildWidgetSummaryPayload(makeState({ entries: [entry(400, 30, 50, 10), { ...entry(200, null, null, null), id: 'q', source: 'Quick add' }] }), '2026-11-27');
    expect(quickAdd.macrosText).toBe('P 30/150g · C 50/200g · F 10/65g');
  });

  it('sends the profile time zone so the widget dates today like the diary', () => {
    const summary = buildWidgetSummaryPayload(makeState({ profile: { timeZone: 'Asia/Kuala_Lumpur' } as AppState['profile'] }), '2026-11-27');
    expect(summary.timeZone).toBe('Asia/Kuala_Lumpur');
  });
});
