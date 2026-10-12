import {describe, expect, it} from 'vitest';
import {needsReveal} from './foodStrip';

describe('needsReveal', () => {
  const strip = {left: 100, right: 500};

  it('returns false when the day is comfortably inside the strip', () => {
    expect(needsReveal(strip, {left: 200, right: 264})).toBe(false);
    expect(needsReveal(strip, {left: 105, right: 169})).toBe(false);
    expect(needsReveal(strip, {left: 430, right: 494})).toBe(false);
  });

  it('returns false when day touches boundaries within tolerance', () => {
    expect(needsReveal(strip, {left: 100, right: 164})).toBe(false);
    expect(needsReveal(strip, {left: 436, right: 500})).toBe(false);
    expect(needsReveal(strip, {left: 99.8, right: 163.8})).toBe(false);
    expect(needsReveal(strip, {left: 436.2, right: 500.2})).toBe(false);
  });

  it('returns true when day is clipped or outside to the left', () => {
    expect(needsReveal(strip, {left: 98, right: 162})).toBe(true);
    expect(needsReveal(strip, {left: 20, right: 84})).toBe(true);
  });

  it('returns true when day is clipped or outside to the right', () => {
    expect(needsReveal(strip, {left: 438, right: 502})).toBe(true);
    expect(needsReveal(strip, {left: 510, right: 574})).toBe(true);
  });
});
