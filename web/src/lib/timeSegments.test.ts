import {describe, expect, it} from 'vitest';
import {
  parseTime,
  to24HourString,
  stepSegment,
  applySegmentDigit,
  getAdjacentSegment,
} from './timeSegments';

describe('timeSegments', () => {
  describe('parseTime', () => {
    it('returns nulls for empty or invalid input', () => {
      expect(parseTime('')).toEqual({hour12: null, minute: null, period: null});
      expect(parseTime('invalid')).toEqual({hour12: null, minute: null, period: null});
    });

    it('parses morning and afternoon times correctly', () => {
      expect(parseTime('00:00')).toEqual({hour12: 12, minute: 0, period: 'AM'});
      expect(parseTime('09:15')).toEqual({hour12: 9, minute: 15, period: 'AM'});
      expect(parseTime('12:00')).toEqual({hour12: 12, minute: 0, period: 'PM'});
      expect(parseTime('17:24')).toEqual({hour12: 5, minute: 24, period: 'PM'});
      expect(parseTime('23:59')).toEqual({hour12: 11, minute: 59, period: 'PM'});
    });
  });

  describe('to24HourString', () => {
    it('converts 12-hour values back to 24-hour time', () => {
      expect(to24HourString(12, 0, 'AM')).toBe('00:00');
      expect(to24HourString(5, 24, 'PM')).toBe('17:24');
      expect(to24HourString(12, 30, 'PM')).toBe('12:30');
      expect(to24HourString(null, null, null)).toBe('');
    });
  });

  describe('stepSegment', () => {
    it('steps hours with wrapping between 1 and 12', () => {
      const initial = parseTime('12:00'); // 12 PM
      expect(stepSegment('hour', initial, 1, '12:00')).toBe('13:00'); // 1 PM
      const onePm = parseTime('13:00');
      expect(stepSegment('hour', onePm, -1, '12:00')).toBe('12:00'); // 12 PM
    });

    it('steps minutes with wrapping between 0 and 59', () => {
      const initial = parseTime('05:59'); // 5:59 AM
      expect(stepSegment('minute', initial, 1, '05:00')).toBe('05:00');
      const zeroMin = parseTime('05:00');
      expect(stepSegment('minute', zeroMin, -1, '05:00')).toBe('05:59');
    });

    it('toggles AM and PM period', () => {
      const pm = parseTime('17:24'); // 5:24 PM
      expect(stepSegment('period', pm, 1, '12:00')).toBe('05:24'); // 5:24 AM
      const am = parseTime('05:24');
      expect(stepSegment('period', am, 1, '12:00')).toBe('17:24'); // 5:24 PM
    });
  });

  describe('applySegmentDigit', () => {
    it('advances to minute when typing single digit > 1 for hour', () => {
      const res = applySegmentDigit('hour', 5, '', {hour12: null, minute: null, period: 'PM'}, '12:00');
      expect(res.nextTime).toBe('17:00');
      expect(res.nextSegment).toBe('minute');
      expect(res.nextBuffer).toBe('');
    });

    it('buffers when typing 1 for hour to allow two-digit hour (e.g. 10..12)', () => {
      const step1 = applySegmentDigit('hour', 1, '', {hour12: null, minute: null, period: 'PM'}, '12:00');
      expect(step1.nextSegment).toBe('hour');
      expect(step1.nextBuffer).toBe('1');

      const step2 = applySegmentDigit('hour', 2, '1', {hour12: 1, minute: 0, period: 'PM'}, '12:00');
      expect(step2.nextTime).toBe('12:00');
      expect(step2.nextSegment).toBe('minute');
      expect(step2.nextBuffer).toBe('');
    });

    it('advances to period when typing minutes', () => {
      const step1 = applySegmentDigit('minute', 2, '', {hour12: 5, minute: 0, period: 'PM'}, '12:00');
      expect(step1.nextSegment).toBe('minute');
      expect(step1.nextBuffer).toBe('2');

      const step2 = applySegmentDigit('minute', 4, '2', {hour12: 5, minute: 2, period: 'PM'}, '12:00');
      expect(step2.nextTime).toBe('17:24');
      expect(step2.nextSegment).toBe('period');
      expect(step2.nextBuffer).toBe('');
    });

    it('immediately advances to period if minute first digit >= 6', () => {
      const res = applySegmentDigit('minute', 7, '', {hour12: 5, minute: 0, period: 'PM'}, '12:00');
      expect(res.nextTime).toBe('17:07');
      expect(res.nextSegment).toBe('period');
      expect(res.nextBuffer).toBe('');
    });
  });

  describe('getAdjacentSegment', () => {
    it('navigates right from hour -> minute -> period', () => {
      expect(getAdjacentSegment('hour', 'right')).toBe('minute');
      expect(getAdjacentSegment('minute', 'right')).toBe('period');
      expect(getAdjacentSegment('period', 'right')).toBe('period');
    });

    it('navigates left from period -> minute -> hour', () => {
      expect(getAdjacentSegment('period', 'left')).toBe('minute');
      expect(getAdjacentSegment('minute', 'left')).toBe('hour');
      expect(getAdjacentSegment('hour', 'left')).toBe('hour');
    });
  });
});
