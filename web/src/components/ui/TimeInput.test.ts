import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {TimeInput} from './TimeInput';

describe('TimeInput', () => {
  it('renders 12-hour segments formatted from a 24-hour value', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Meal time',
        value: '17:24',
      })
    );
    expect(markup).toContain('05');
    expect(markup).toContain('24');
    expect(markup).toContain('PM');
    expect(markup).toContain('value="17:24"');
  });

  it('renders morning AM hours properly', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Meal time',
        value: '08:05',
      })
    );
    expect(markup).toContain('08');
    expect(markup).toContain('05');
    expect(markup).toContain('AM');
  });

  it('renders midnight (00:00) as 12:00 AM', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Meal time',
        value: '00:00',
      })
    );
    expect(markup).toContain('12');
    expect(markup).toContain('00');
    expect(markup).toContain('AM');
  });

  it('renders noon (12:00) as 12:00 PM', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Meal time',
        value: '12:00',
      })
    );
    expect(markup).toContain('12');
    expect(markup).toContain('00');
    expect(markup).toContain('PM');
  });

  it('renders dashed placeholders when value is empty', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Move to time (optional)',
        value: '',
      })
    );
    expect(markup).toContain('--');
    expect(markup).toContain('value=""');
  });

  it('renders accessible native time input for form submission', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        id: 'move-food-time',
        name: 'destinationTime',
        label: 'Move to time (optional)',
        value: '17:24',
        required: true,
      })
    );
    expect(markup).toContain('type="time"');
    expect(markup).toContain('id="move-food-time"');
    expect(markup).toContain('name="destinationTime"');
    expect(markup).toContain('required');
  });

  it('includes accessible spinbutton roles and ARIA metadata for segments', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Move to time (optional)',
        value: '17:24',
      })
    );
    expect(markup).toContain('role="spinbutton"');
    expect(markup).toContain('aria-label="Hours"');
    expect(markup).toContain('aria-label="Minutes"');
    expect(markup).toContain('aria-label="AM or PM"');
    expect(markup).toContain('aria-valuenow="5"');
    expect(markup).toContain('aria-valuenow="24"');
  });

  it('handles disabled state properly', () => {
    const markup = renderToStaticMarkup(
      createElement(TimeInput, {
        label: 'Meal time',
        value: '17:24',
        disabled: true,
      })
    );
    expect(markup).toContain('disabled');
    expect(markup).toContain('tabindex="-1"');
  });
});
