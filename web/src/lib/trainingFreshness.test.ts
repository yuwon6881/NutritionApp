import { expect, it } from 'vitest';
import { trainingWarning } from './trainingFreshness';
import type { AppState } from '../types';

const current = { id: 'a', workoutConnected: true, workoutWarning: null } as AppState;
const stored = { ...current, workoutWarning: 'Stored failure' };
it('keeps the live success or failure after an independent bootstrap refresh', () => {
  expect(trainingWarning(current, stored, 'a')).toBeNull();
  expect(trainingWarning({ ...current, workoutWarning: 'Live failure' }, stored, 'a')).toBe('Live failure');
});
it('honors disconnection and isolates outcomes between accounts', () => {
  expect(trainingWarning(current, { ...stored, workoutConnected: false }, 'a')).toBe('Stored failure');
  expect(trainingWarning(current, stored, 'b')).toBe('Stored failure');
  expect(trainingWarning(current, { ...stored, id: 'b' }, 'a')).toBe('Stored failure');
  expect(trainingWarning(current, stored, null)).toBe('Stored failure');
});
