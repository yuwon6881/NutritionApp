import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FoodDaySkeleton } from './Skeleton';

describe('FoodDaySkeleton', () => {
  const html = renderToStaticMarkup(createElement(FoodDaySkeleton, { title: 'Friday, Oct 23' }));

  it('announces one polite status and marks the region busy', () => {
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('Loading diary…');
  });

  it('keeps the real summary and timeline shapes, hidden from assistive technology', () => {
    expect(html).toContain('food-day-summary');
    expect(html).toContain('food-day-nutrient protein');
    expect(html).toContain('food-time-row');
    expect(html).toContain('Friday, Oct 23');
    expect(html.match(/<section[^>]*aria-hidden="true"/g)).toHaveLength(1);
  });

  it('never draws a plain-text-only loading line', () => {
    const withoutStatus = html.replace(/<p class="sr-only"[^>]*>[^<]*<\/p>/, '');
    expect(withoutStatus).not.toMatch(/Loading/);
  });

  it('renders a block in place of the title when the date is unknown', () => {
    const untitled = renderToStaticMarkup(createElement(FoodDaySkeleton, {}));
    expect(untitled).not.toContain('<h2>Friday');
    expect(untitled).toContain('food-day-skeleton-title');
  });
});
