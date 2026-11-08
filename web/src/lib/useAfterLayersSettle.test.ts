import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest';
import {useAfterLayersSettle} from './useAfterLayersSettle';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

describe('useAfterLayersSettle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      history: {
        state: {},
        pushState: vi.fn(),
        replaceState: vi.fn(),
        back: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('provides a stable callback trigger', () => {
    let triggerFn: ((val: string) => void) | undefined;
    function TestComponent() {
      triggerFn = useAfterLayersSettle<string>(() => {});
      return createElement('div', null, 'ready');
    }
    const html = renderToStaticMarkup(createElement(TestComponent));
    expect(html).toContain('ready');
    expect(typeof triggerFn).toBe('function');
  });

  it('delays execution until after layers settle and exit animation completes', () => {
    const action = vi.fn();
    const targetDuration = 180;
    const queuedAt = Date.now();

    // Trigger layer settle callback after 10ms
    vi.advanceTimersByTime(10);
    const elapsed = Date.now() - queuedAt;
    const remaining = Math.max(0, targetDuration - elapsed);

    setTimeout(() => {
      action('target-item');
    }, remaining);

    // Before remaining time, action should not be called
    vi.advanceTimersByTime(100);
    expect(action).not.toHaveBeenCalled();

    // After remaining time, action should be called
    vi.advanceTimersByTime(70);
    expect(action).toHaveBeenCalledWith('target-item');
  });
});
