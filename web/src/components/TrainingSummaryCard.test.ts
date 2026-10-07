import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrainingSummaryCard } from './TrainingSummaryCard';
import type { TrainingSummary } from '../types';

describe('TrainingSummaryCard', () => {
  it('renders weekly scheduled workouts in program position order excluding rests', () => {
    const summaries: TrainingSummary[] = [
      {
        id: 'upcoming:4',
        status: 'upcoming',
        localDate: '2026-10-07',
        actualDate: null,
        startedAt: null,
        finishedAt: null,
        workoutName: 'Full Body 4',
        muscleGroups: [],
        workingSetCount: 0,
        externalVolumeKg: null,
        systemVolumeKg: null,
        averageRpe: null,
        programWeek: 1,
        programPosition: 4,
      },
      {
        id: 'upcoming:5',
        status: 'upcoming',
        localDate: '2026-10-07',
        actualDate: null,
        startedAt: null,
        finishedAt: null,
        workoutName: 'Full Body 5 (Pump Day)',
        muscleGroups: [],
        workingSetCount: 0,
        externalVolumeKg: null,
        systemVolumeKg: null,
        averageRpe: null,
        programWeek: 1,
        programPosition: 6,
      },
      {
        id: 'passed:1',
        status: 'completed',
        localDate: '2026-10-01',
        actualDate: '2026-10-01',
        startedAt: null,
        finishedAt: null,
        workoutName: 'Full Body 1',
        muscleGroups: [],
        workingSetCount: 0,
        externalVolumeKg: null,
        systemVolumeKg: null,
        averageRpe: null,
        programWeek: 1,
        programPosition: 0,
      },
      {
        id: 'passed:2',
        status: 'completed',
        localDate: '2026-10-03',
        actualDate: '2026-10-03',
        startedAt: null,
        finishedAt: null,
        workoutName: 'Full Body 2',
        muscleGroups: [],
        workingSetCount: 0,
        externalVolumeKg: null,
        systemVolumeKg: null,
        averageRpe: null,
        programWeek: 1,
        programPosition: 1,
      },
      {
        id: 'session:3',
        status: 'completed',
        localDate: '2026-10-06',
        actualDate: '2026-10-06',
        startedAt: '2026-10-06T10:00:00Z',
        finishedAt: '2026-10-06T11:00:00Z',
        workoutName: 'Full Body 3',
        muscleGroups: ['Chest', 'Back'],
        workingSetCount: 2,
        externalVolumeKg: 100,
        systemVolumeKg: null,
        averageRpe: 8,
        programWeek: 1,
        programPosition: 3,
      },
    ];

    const html = renderToStaticMarkup(
      createElement(TrainingSummaryCard, {
        summaries,
        workoutConnected: true,
      })
    );

    const pos1 = html.indexOf('Full Body 1');
    const pos2 = html.indexOf('Full Body 2');
    const pos3 = html.indexOf('Full Body 3');
    const pos4 = html.indexOf('Full Body 4');
    const pos5 = html.indexOf('Full Body 5 (Pump Day)');

    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos1);
    expect(pos3).toBeGreaterThan(pos2);
    expect(pos4).toBeGreaterThan(pos3);
    expect(pos5).toBeGreaterThan(pos4);

    expect(html).toContain('Up next');
    expect(html).toContain('Completed');
    expect(html).toContain('2 sets');
    expect(html).not.toContain('Rest Day');
  });

  it('falls back to recorded, in-progress, then up-next workouts in time order when no programPosition is present', () => {
    const summaries: TrainingSummary[] = [
      {
        id: 'upcoming:1',
        status: 'upcoming',
        localDate: '2026-10-07',
        startedAt: null,
        finishedAt: null,
        workoutName: 'Upcoming Workout',
        muscleGroups: [],
        workingSetCount: 0,
        externalVolumeKg: null,
        systemVolumeKg: null,
        averageRpe: null,
      },
      {
        id: 'session:1',
        status: 'completed',
        localDate: '2026-10-06',
        actualDate: '2026-10-06',
        startedAt: '2026-10-06T10:00:00Z',
        finishedAt: '2026-10-06T11:00:00Z',
        workoutName: 'Past Workout',
        muscleGroups: [],
        workingSetCount: 3,
        externalVolumeKg: null,
        systemVolumeKg: null,
        averageRpe: null,
      },
    ];

    const html = renderToStaticMarkup(
      createElement(TrainingSummaryCard, {
        summaries,
        workoutConnected: true,
      })
    );

    // Read like the week: what was done, then what is next.
    const posUpNext = html.indexOf('Upcoming Workout');
    const posPast = html.indexOf('Past Workout');
    expect(posPast).toBeGreaterThan(-1);
    expect(posPast).toBeLessThan(posUpNext);
  });
  it('lists older completed sessions before newer ones, then up next', () => {
    const summaries: TrainingSummary[] = [
      { id: 'u4', status: 'upcoming', localDate: '2026-10-07', startedAt: null, finishedAt: null, workoutName: 'Full Body 4', muscleGroups: [], workingSetCount: 3, externalVolumeKg: null, systemVolumeKg: null, averageRpe: null },
      { id: 'u5', status: 'upcoming', localDate: '2026-10-07', startedAt: null, finishedAt: null, workoutName: 'Full Body 5', muscleGroups: [], workingSetCount: 3, externalVolumeKg: null, systemVolumeKg: null, averageRpe: null },
      { id: 's3', status: 'completed', localDate: '2026-10-06', startedAt: '2026-10-06T10:00:00Z', finishedAt: '2026-10-06T11:00:00Z', workoutName: 'Full Body 3', muscleGroups: [], workingSetCount: 3, externalVolumeKg: null, systemVolumeKg: null, averageRpe: null },
      { id: 's1', status: 'completed', localDate: '2026-10-01', startedAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T11:00:00Z', workoutName: 'Full Body 1', muscleGroups: [], workingSetCount: 3, externalVolumeKg: null, systemVolumeKg: null, averageRpe: null },
      { id: 's2', status: 'completed', localDate: '2026-10-03', startedAt: '2026-10-03T10:00:00Z', finishedAt: '2026-10-03T11:00:00Z', workoutName: 'Full Body 2', muscleGroups: [], workingSetCount: 3, externalVolumeKg: null, systemVolumeKg: null, averageRpe: null },
    ];
    const html = renderToStaticMarkup(createElement(TrainingSummaryCard, { summaries, workoutConnected: true, timeZone: 'UTC' }));
    const order = ['Full Body 1', 'Full Body 2', 'Full Body 3', 'Full Body 4', 'Full Body 5'].map(name => html.indexOf(name));
    expect(order.every(position => position > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
