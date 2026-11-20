import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogFoodAiForm } from './LogFoodAiForm';

const baseProps = {
  date: '2026-11-20',
  busy: false,
  preparingPhoto: false,
  mode: 'description' as const,
  onModeChange: () => {},
  description: '150 g coconut rice, one egg, sambal',
  onDescriptionChange: () => {},
  photo: null as string | null,
  onPhotoFile: () => {},
  onClearPhoto: () => {},
  hasSavedReview: false,
  scanDraft: null,
  storageError: '',
  onSubmit: () => {},
  onBackToBarcode: () => {},
};

describe('LogFoodAiForm loading states', () => {
  it('shows an in-place progress line and one polite status in Describe mode without an extra skeleton card', () => {
    const html = renderToStaticMarkup(createElement(LogFoodAiForm, {
      ...baseProps,
      mode: 'description',
      busy: true,
    }));
    expect(html).toContain('ai-description-field is-analyzing');
    expect(html).toContain('ai-description-progress');
    expect(html).not.toContain('skeleton-block');
    expect(html).not.toContain('ai-describe-progress');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('Estimating nutrients from your description.');
    expect(html).toContain('Analyzing meal…');
  });

  it('keeps ScanOverlay and one status announcement in Photo and Label modes while scanning', () => {
    for (const [mode, overlayLabel, buttonLabel, statusPrefix] of [
      ['photo', 'Scanning meal…', 'Analyzing meal…', 'Estimating nutrients from your photo.'],
      ['label', 'Reading label…', 'Analyzing label…', 'Reading nutrition facts from your label.'],
    ] as const) {
      const html = renderToStaticMarkup(createElement(LogFoodAiForm, {
        ...baseProps,
        mode,
        photo: 'dGVzdA==',
        busy: true,
      }));
      expect(html).toContain('ai-photo-preview is-scanning');
      expect(html).toContain('data-scan-overlay');
      expect(html).toContain(overlayLabel);
      expect(html).toContain(buttonLabel);
      expect(html).toContain(statusPrefix);
      // ScanOverlay already carries role="status", so the form does not announce a second live region.
      expect(html.match(/role="status"/g)).toHaveLength(1);
    }
  });

  it('does not trigger scanning or Analyzing labels while preparing a picked photo', () => {
    const html = renderToStaticMarkup(createElement(LogFoodAiForm, {
      ...baseProps,
      mode: 'photo',
      photo: 'dGVzdA==',
      busy: false,
      preparingPhoto: true,
    }));
    expect(html).not.toContain('data-scan-overlay');
    expect(html).not.toContain('ai-photo-preview is-scanning');
    expect(html).toContain('Preparing photo…');
    expect(html).toContain('Analyze meal');
    expect(html).not.toContain('Analyzing meal…');
  });
});
