import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScanOverlay } from './ScanOverlay';

describe('ScanOverlay', () => {
  it('renders nothing while inactive so it stops when the response or error arrives', () => {
    expect(renderToStaticMarkup(createElement(ScanOverlay, { active: false }))).toBe('');
  });

  it('announces one polite status and hides the decoration from assistive technology', () => {
    const html = renderToStaticMarkup(createElement(ScanOverlay, { active: true, label: 'Reading label' }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('Reading label…');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(5);
  });
});
