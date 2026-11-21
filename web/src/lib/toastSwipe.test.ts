import { describe, expect, it } from 'vitest';
import {
  calculateSwipeOpacity,
  calculateSwipeOutcome,
  classifyGestureAxis,
  formatToastMessage,
  MAX_TOAST_MESSAGE_LENGTH,
} from './toastSwipe';

describe('formatToastMessage', () => {
  it('returns empty string for empty input', () => {
    expect(formatToastMessage('')).toBe('');
  });

  it('preserves messages within the character limit', () => {
    const short = 'Deleted 2 foods';
    expect(formatToastMessage(short)).toBe(short);

    const exact = 'A'.repeat(MAX_TOAST_MESSAGE_LENGTH);
    expect(formatToastMessage(exact)).toBe(exact);
    expect(formatToastMessage(exact)).toHaveLength(MAX_TOAST_MESSAGE_LENGTH);
  });

  it('caps messages that exceed the limit with an ellipsis', () => {
    const long = 'Deleted '.padEnd(120, 'Very Delicious Food Item Name ');
    const capped = formatToastMessage(long);

    expect(capped.length).toBeLessThanOrEqual(MAX_TOAST_MESSAGE_LENGTH);
    expect(capped.endsWith('…')).toBe(true);
    expect(capped.startsWith('Deleted')).toBe(true);
  });

  it('trims whitespace before adding the ellipsis', () => {
    const padded = 'Short text here' + ' '.repeat(70) + 'tail';
    const capped = formatToastMessage(padded, 20);
    expect(capped).toBe('Short text here…');
  });

  it('respects custom max lengths', () => {
    expect(formatToastMessage('Hello world', 5)).toBe('Hell…');
  });
});

describe('calculateSwipeOutcome', () => {
  const width = 360;

  it('dismisses right when dragged past threshold', () => {
    expect(calculateSwipeOutcome(65, 400, width)).toBe('dismiss-right');
    expect(calculateSwipeOutcome(100, 500, width)).toBe('dismiss-right');
  });

  it('dismisses left when dragged past negative threshold', () => {
    expect(calculateSwipeOutcome(-65, 400, width)).toBe('dismiss-left');
    expect(calculateSwipeOutcome(-100, 500, width)).toBe('dismiss-left');
  });

  it('dismisses on a quick flick even below full distance threshold', () => {
    expect(calculateSwipeOutcome(35, 120, width)).toBe('dismiss-right');
    expect(calculateSwipeOutcome(-35, 120, width)).toBe('dismiss-left');
  });

  it('settles back if the flick was too slow or too short', () => {
    expect(calculateSwipeOutcome(25, 100, width)).toBe('settle');
    expect(calculateSwipeOutcome(35, 400, width)).toBe('settle');
    expect(calculateSwipeOutcome(0, 50, width)).toBe('settle');
  });
});

describe('calculateSwipeOpacity', () => {
  const width = 400;

  it('returns 1.0 when at rest (dx = 0)', () => {
    expect(calculateSwipeOpacity(0, width)).toBe(1);
  });

  it('fades gradually as dx increases', () => {
    const half = calculateSwipeOpacity(150, width);
    expect(half).toBeLessThan(1);
    expect(half).toBeGreaterThan(0.1);
  });

  it('clamps to a floor of 0.1 so the card never vanishes abruptly during drag', () => {
    expect(calculateSwipeOpacity(500, width)).toBe(0.1);
    expect(calculateSwipeOpacity(-500, width)).toBe(0.1);
  });
});

describe('classifyGestureAxis', () => {
  it('marks sub-6px movements as pending deadband', () => {
    expect(classifyGestureAxis(3, 4)).toBe('pending');
    expect(classifyGestureAxis(-2, 1)).toBe('pending');
  });

  it('locks horizontal when horizontal movement dominates', () => {
    expect(classifyGestureAxis(15, 4)).toBe('horizontal');
    expect(classifyGestureAxis(-20, 10)).toBe('horizontal');
    expect(classifyGestureAxis(10, 10)).toBe('horizontal');
  });

  it('locks vertical when vertical movement dominates', () => {
    expect(classifyGestureAxis(4, 18)).toBe('vertical');
    expect(classifyGestureAxis(-5, -25)).toBe('vertical');
  });
});
