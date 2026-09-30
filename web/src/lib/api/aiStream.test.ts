import { describe, expect, it, vi } from 'vitest';
import { SseParser, streamChatWithAi } from './aiStream';

describe('SseParser', () => {
  it('parses single complete SSE block', () => {
    const parser = new SseParser();
    const events = parser.push('event: status\ndata: {"label":"Looking up food"}\n\n');
    expect(events).toEqual([
      { event: 'status', data: '{"label":"Looking up food"}' },
    ]);
  });

  it('handles chunked buffers across multiple pushes', () => {
    const parser = new SseParser();
    expect(parser.push('event: delta\n')).toEqual([]);
    expect(parser.push('data: {"text":"Hello"}\n\n')).toEqual([
      { event: 'delta', data: '{"text":"Hello"}' },
    ]);
  });

  it('ignores comments and flushes trailing event', () => {
    const parser = new SseParser();
    parser.push(': heartbeat comment\n');
    parser.push('event: delta\ndata: {"text":"Done"}');
    const flushed = parser.flush();
    expect(flushed).toEqual([
      { event: 'delta', data: '{"text":"Done"}' },
    ]);
  });
});

describe('streamChatWithAi', () => {
  it('dispatches status, delta, and done events properly', async () => {
    const ssePayload =
      'event: status\ndata: {"label":"Checking targets"}\n\n' +
      'event: delta\ndata: {"text":"You have"}\n\n' +
      'event: delta\ndata: {"text":" 500 kcal remaining"}\n\n' +
      'event: done\ndata: {"reply":"You have 500 kcal remaining","actions":[]}\n\n';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: () => Promise.resolve(ssePayload),
    });
    vi.stubGlobal('fetch', mockFetch);

    const onStatus = vi.fn();
    const onDelta = vi.fn();

    const response = await streamChatWithAi(
      {
        message: 'How many calories left?',
        history: [],
      },
      { onStatus, onDelta },
    );

    expect(onStatus).toHaveBeenCalledWith('Checking targets');
    expect(onDelta).toHaveBeenCalledWith('You have');
    expect(onDelta).toHaveBeenCalledWith(' 500 kcal remaining');
    expect(response.reply).toBe('You have 500 kcal remaining');

    vi.unstubAllGlobals();
  });
});
