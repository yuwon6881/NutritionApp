export type TimeSegment = 'hour' | 'minute' | 'period';

export interface ParsedTime {
  hour12: number | null;
  minute: number | null;
  period: 'AM' | 'PM' | null;
}

export function parseTime(val: string): ParsedTime {
  if (!val || !val.includes(':')) {
    return {hour12: null, minute: null, period: null};
  }
  const [hStr, mStr] = val.split(':');
  const h24 = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h24) || !Number.isFinite(m)) {
    return {hour12: null, minute: null, period: null};
  }
  const clampedH = Math.min(23, Math.max(0, h24));
  const clampedM = Math.min(59, Math.max(0, m));
  return {
    hour12: clampedH % 12 || 12,
    minute: clampedM,
    period: clampedH >= 12 ? 'PM' : 'AM',
  };
}

export function to24HourString(
  hour12: number | null,
  minute: number | null,
  period: 'AM' | 'PM' | null
): string {
  if (hour12 == null && minute == null) return '';
  const effectiveH = hour12 ?? 12;
  const effectiveM = minute ?? 0;
  const effectiveP = period ?? 'PM';
  const h24 = effectiveP === 'PM' ? (effectiveH % 12) + 12 : effectiveH % 12;
  return `${String(h24).padStart(2, '0')}:${String(effectiveM).padStart(2, '0')}`;
}

export function stepSegment(
  segment: TimeSegment,
  parsed: ParsedTime,
  delta: 1 | -1,
  fallbackTime: string
): string {
  const fallback = parseTime(fallbackTime);
  const fallbackPeriod = fallback.period ?? 'PM';

  if (segment === 'hour') {
    const cur = parsed.hour12 ?? fallback.hour12 ?? 12;
    let next = cur + delta;
    if (next > 12) next = 1;
    if (next < 1) next = 12;
    return to24HourString(next, parsed.minute ?? 0, parsed.period ?? fallbackPeriod);
  }

  if (segment === 'minute') {
    const cur = parsed.minute ?? 0;
    let next = cur + delta;
    if (next > 59) next = 0;
    if (next < 0) next = 59;
    return to24HourString(parsed.hour12 ?? fallback.hour12 ?? 12, next, parsed.period ?? fallbackPeriod);
  }

  const cur = parsed.period ?? fallbackPeriod;
  const next = cur === 'AM' ? 'PM' : 'AM';
  return to24HourString(parsed.hour12 ?? fallback.hour12 ?? 12, parsed.minute ?? 0, next);
}

export interface DigitStepResult {
  nextTime: string;
  nextSegment: TimeSegment;
  nextBuffer: string;
}

export function applySegmentDigit(
  segment: 'hour' | 'minute',
  digit: number,
  buffer: string,
  parsed: ParsedTime,
  fallbackTime: string
): DigitStepResult {
  const fallback = parseTime(fallbackTime);
  const effectivePeriod = parsed.period ?? fallback.period ?? 'PM';

  if (segment === 'hour') {
    if (!buffer) {
      if (digit > 1) {
        return {
          nextTime: to24HourString(digit, parsed.minute ?? 0, effectivePeriod),
          nextSegment: 'minute',
          nextBuffer: '',
        };
      }
      const h = digit === 0 ? 12 : digit;
      return {
        nextTime: to24HourString(h, parsed.minute ?? 0, effectivePeriod),
        nextSegment: 'hour',
        nextBuffer: String(digit),
      };
    }

    const combined = Number(buffer + digit);
    if (combined >= 1 && combined <= 12) {
      return {
        nextTime: to24HourString(combined, parsed.minute ?? 0, effectivePeriod),
        nextSegment: 'minute',
        nextBuffer: '',
      };
    }
    const safeDigit = digit >= 1 && digit <= 12 ? digit : 12;
    return {
      nextTime: to24HourString(safeDigit, parsed.minute ?? 0, effectivePeriod),
      nextSegment: 'minute',
      nextBuffer: '',
    };
  }

  // segment === 'minute'
  if (!buffer) {
    if (digit >= 6) {
      return {
        nextTime: to24HourString(parsed.hour12 ?? 12, digit, effectivePeriod),
        nextSegment: 'period',
        nextBuffer: '',
      };
    }
    return {
      nextTime: to24HourString(parsed.hour12 ?? 12, digit, effectivePeriod),
      nextSegment: 'minute',
      nextBuffer: String(digit),
    };
  }

  const combined = Number(buffer + digit);
  if (combined <= 59) {
    return {
      nextTime: to24HourString(parsed.hour12 ?? 12, combined, effectivePeriod),
      nextSegment: 'period',
      nextBuffer: '',
    };
  }
  return {
    nextTime: to24HourString(parsed.hour12 ?? 12, digit, effectivePeriod),
    nextSegment: 'minute',
    nextBuffer: String(digit),
  };
}

export function getAdjacentSegment(
  current: TimeSegment,
  direction: 'left' | 'right'
): TimeSegment {
  if (direction === 'right') {
    if (current === 'hour') return 'minute';
    if (current === 'minute') return 'period';
    return 'period';
  }
  if (current === 'period') return 'minute';
  if (current === 'minute') return 'hour';
  return 'hour';
}
