import {createElement, useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {useLingering} from './useLingering';

function StaticComp({active}: {active: boolean}) {
  const lingering = useLingering(active);
  return createElement('div', null, lingering ? 'lingering' : 'idle');
}

function TransitionComp() {
  const [active, setActive] = useState(true);
  const lingering = useLingering(active);
  if (active) {
    setActive(false);
  }
  return createElement('div', null, lingering ? 'lingering' : 'idle');
}

describe('useLingering', () => {
  it('returns false when initially idle', () => {
    const markup = renderToStaticMarkup(createElement(StaticComp, {active: false}));
    expect(markup).toContain('idle');
  });

  it('returns false while active is true (does not linger while active)', () => {
    const markup = renderToStaticMarkup(createElement(StaticComp, {active: true}));
    expect(markup).toContain('idle');
  });

  it('immediately returns true in the same render when active transitions from true to false', () => {
    // Before the fix, transitioning from true to false rendered 'idle' because lingering was
    // deferred to useEffect, causing a 1-frame unmount gap. With render-phase state adjustment,
    // the very first render after active becomes false already reports lingering.
    const markup = renderToStaticMarkup(createElement(TransitionComp));
    expect(markup).toContain('lingering');
  });
});
