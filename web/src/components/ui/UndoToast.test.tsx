import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dismissToast,
  formatToastMessage,
  MAX_TOAST_MESSAGE_LENGTH,
  showNotice,
  showUndo,
  UndoToastHost,
} from './UndoToast';

describe('UndoToastHost', () => {
  beforeEach(() => {
    dismissToast();
  });

  it('renders null when no notice or result is present', () => {
    const html = renderToStaticMarkup(createElement(UndoToastHost));
    expect(html).toBe('');
  });

  it('renders a plain notice with polite status, icon, and dismiss button, without undo button', () => {
    showNotice('Preferences saved');
    const html = renderToStaticMarkup(createElement(UndoToastHost));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Preferences saved');
    expect(html).toContain('aria-label="Dismiss notice"');
    expect(html).not.toContain('>Undo<');
  });

  it('renders an undoable action notice with both Undo and Dismiss buttons', () => {
    const onUndo = vi.fn();
    showUndo('Deleted 2 foods', onUndo);
    const html = renderToStaticMarkup(createElement(UndoToastHost));

    expect(html).toContain('role="status"');
    expect(html).toContain('Deleted 2 foods');
    expect(html).toContain('>Undo<');
    expect(html).toContain('aria-label="Dismiss notice"');
  });

  it('caps messages that exceed MAX_TOAST_MESSAGE_LENGTH with ellipsis and full title', () => {
    const longMessage = 'Deleted '.padEnd(180, 'Delicious Protein Shake with Extra Oats and Bananas ');
    showNotice(longMessage);
    const html = renderToStaticMarkup(createElement(UndoToastHost));

    const expectedCapped = formatToastMessage(longMessage);
    expect(expectedCapped.length).toBeLessThanOrEqual(MAX_TOAST_MESSAGE_LENGTH);
    expect(expectedCapped.endsWith('…')).toBe(true);
    expect(html).toContain(expectedCapped);
    expect(html).toContain(`title="${longMessage}"`);
  });

  it('dismisses entirely when dismissToast is called', () => {
    showNotice('Temporary notice');
    expect(renderToStaticMarkup(createElement(UndoToastHost))).toContain('Temporary notice');

    dismissToast();
    expect(renderToStaticMarkup(createElement(UndoToastHost))).toBe('');
  });
});
