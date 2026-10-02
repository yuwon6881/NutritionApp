import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

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
    expect(html).toContain('Your food diary stays saved on this device. Reload to continue where you left off.');
    expect(html).toContain('Reload Nutrition');
    expect(html).toContain('Try again');
    expect(html).toContain('reload-recovery');
  });
});
