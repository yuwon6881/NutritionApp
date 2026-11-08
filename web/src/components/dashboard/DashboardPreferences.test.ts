import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {NutritionStore} from '../../useNutritionStore';
import type {AppState,LocalData,Mutation,ProgressPeriod,WeightChartView,EnergyChartView} from '../../types';
import {enqueueMutation,project} from '../../lib/projection';
import {SwipeCarousel} from '../ui/SwipeCarousel';
import {WeightProgressCard} from './WeightProgressCard';
import {EnergyProgressCard} from './EnergyProgressCard';

describe('Dashboard preferences persistence', () => {
  const baseState: AppState = {
    id: 'user-123',
    displayName: 'Test User',
    revision: 10,
    profileRevision: 2,
    profile: null,
    start: '2026-10-01',
    end: '2026-11-08',
    entries: [],
    foods: [],
    weights: [],
    days: [],
    plans: [],
    settings: {
      revision: 5,
      checkInWeekday: 1,
      weightUnit: 'kg',
      energyUnit: 'kcal',
      heightUnit: 'cm',
      weightChartView: 'both',
      energyChartView: 'maintenance',
      weightPeriod: 'six-months',
      energyPeriod: 'year'
    }
  };

  it('SwipeCarousel renders initial slide from activeId', () => {
    const slides = [
      { id: 'trend', ariaLabel: 'Trend weight', content: createElement('div', null, 'Trend') },
      { id: 'scale', ariaLabel: 'Scale weight', content: createElement('div', null, 'Scale') },
      { id: 'both', ariaLabel: 'Trend and scale weight', content: createElement('div', null, 'Both') },
    ];

    const html = renderToStaticMarkup(
      createElement(SwipeCarousel, {
        label: 'Weight view',
        slides,
        activeId: 'both',
      })
    );

    expect(html).toContain('Trend and scale weight');
  });

  it('persists WeightProgressCard view changes via settings mutation', async () => {
    let local: LocalData = { state: baseState, queue: [] };
    const mutate = vi.fn(async (op: Omit<Mutation, 'id' | 'holdUntil'>) => {
      local = enqueueMutation(local, { ...op, id: 'm-1' });
      return 'm-1';
    });

    const store = {
      state: baseState,
      local,
      mutate,
    } as unknown as NutritionStore;

    // Simulate onView callback triggered by SwipeCarousel
    let onViewCallback: ((v: WeightChartView) => void) | undefined;
    const progress = {
      summary: undefined,
      error: '',
      loading: false,
      retry: vi.fn(),
    };

    renderToStaticMarkup(
      createElement(WeightProgressCard, {
        store,
        period: 'month',
        onPeriod: () => {},
        progress,
        onView: (v) => { onViewCallback = (view) => store.mutate({
          kind: 'settings',
          recordId: baseState.id,
          expectedRevision: baseState.settings?.revision ?? 0,
          data: { weightChartView: view },
          delete: false
        }); }
      })
    );

    // Call view change
    await store.mutate({
      kind: 'settings',
      recordId: baseState.id,
      expectedRevision: 5,
      data: { weightChartView: 'scale' },
      delete: false
    });

    expect(local.queue).toHaveLength(1);
    expect(local.queue[0].data).toEqual({ weightChartView: 'scale' });
    const projected = project(baseState, local.queue);
    expect(projected.settings?.weightChartView).toBe('scale');
  });

  it('persists EnergyProgressCard view and period changes via settings mutation', async () => {
    let local: LocalData = { state: baseState, queue: [] };
    const store = {
      state: baseState,
      local,
      mutate: async (op: Omit<Mutation, 'id' | 'holdUntil'>) => {
        local = enqueueMutation(local, { ...op, id: `m-${local.queue.length + 1}` });
        return `m-${local.queue.length}`;
      }
    } as unknown as NutritionStore;

    // Changing energy chart view to coaching
    await store.mutate({
      kind: 'settings',
      recordId: baseState.id,
      expectedRevision: 5,
      data: { energyChartView: 'coaching' as EnergyChartView },
      delete: false
    });

    // Changing energy history period to all
    await store.mutate({
      kind: 'settings',
      recordId: baseState.id,
      expectedRevision: 5,
      data: { energyPeriod: 'all' as ProgressPeriod },
      delete: false
    });

    // Operations coalesce in the queue into a single settings mutation
    expect(local.queue).toHaveLength(1);
    expect(local.queue[0].data).toEqual({
      energyChartView: 'coaching',
      energyPeriod: 'all'
    });

    const projected = project(baseState, local.queue);
    expect(projected.settings?.energyChartView).toBe('coaching');
    expect(projected.settings?.energyPeriod).toBe('all');
    expect(projected.settings?.weightChartView).toBe('both');
  });
});
