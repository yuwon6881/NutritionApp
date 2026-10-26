import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, isStaleVersionError } from './ErrorBoundary';

describe('NutritionApp ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, null, createElement('div', null, 'Normal content'))
    );
    expect(html).toContain('Normal content');
  });

  it('renders enhanced reload view with branding and actions when failed state is active', () => {
    const boundary = new ErrorBoundary({ children: createElement('div', null, 'Normal content') });
    boundary.state = { failed: true, reloading: false };

    const rendered = boundary.render();
    const html = renderToStaticMarkup(rendered as import('react').ReactElement);

    expect(html).toContain('role="alert"');
    expect(html).toContain('NUTRITION');
    expect(html).toContain('This view needs a reload');
    expect(html).toContain('Your diary is saved. Reload to continue.');
    expect(html).toContain('Reload Nutrition');
    expect(html).toContain('Try again');
    expect(html).toContain('reload-recovery');
  });
});

describe('isStaleVersionError', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats a missing script or stylesheet while online as an outdated version', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isStaleVersionError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true);
    expect(isStaleVersionError(new Error('Unable to preload CSS for /assets/Coach-x.css'))).toBe(true);
    expect(isStaleVersionError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('leaves a missing file offline to the connection recovery', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isStaleVersionError(new Error('Unable to preload CSS for /assets/Coach-x.css'))).toBe(false);
  });
});
