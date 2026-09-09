import {expect,it} from 'vitest';
import {
  begin,
  enqueue,
  etaSeconds,
  initialQueueState,
  nextCode,
  outstanding,
  settle,
  waitMs,
  PACING_MS,
} from './scanQueue';

it('deduplicates codes durably unless previously failed or not found', () => {
  let q = initialQueueState();
  q = enqueue(q, '12345678');
  q = enqueue(q, '12345678');
  expect(q.items).toHaveLength(1);
  expect(q.items[0].status).toBe('queued');

  // Mark as not-found
  q = settle(q, '12345678', {status: 'not-found'}, 1000);
  expect(q.items[0].status).toBe('not-found');

  // Deliberate re-scan of not-found code resets to queued
  q = enqueue(q, '12345678');
  expect(q.items).toHaveLength(1);
  expect(q.items[0].status).toBe('queued');

  // Mark as failed
  q = settle(q, '12345678', {status: 'failed'}, 2000);
  expect(q.items[0].status).toBe('failed');
  q = enqueue(q, '12345678');
  expect(q.items[0].status).toBe('queued');
});

it('enforces serial lookups: yields nothing while any lookup is in flight', () => {
  let q = initialQueueState();
  q = enqueue(q, 'code-1');
  q = enqueue(q, 'code-2');

  const first = nextCode(q, 0);
  expect(first).toBe('code-1');

  q = begin(q, 'code-1', 0);
  // While looking-up, nextCode must yield undefined
  expect(nextCode(q, 0)).toBeUndefined();
  expect(nextCode(q, 10000)).toBeUndefined();

  q = settle(q, 'code-1', {status: 'added', name: 'Food 1'}, 500);
  // Now that looking-up settled, check pacing window
  expect(nextCode(q, 500)).toBeUndefined(); // within 4200 ms pacing window
  expect(nextCode(q, 4200)).toBe('code-2');
});

it('enforces exact 4200 ms pacing between fresh lookups', () => {
  let q = initialQueueState();
  q = enqueue(q, 'code-1');
  q = enqueue(q, 'code-2');

  const now = 10000;
  q = begin(q, 'code-1', now);
  expect(q.nextAt).toBe(now + PACING_MS);
  expect(waitMs(q, now + 1000)).toBe(3200);

  q = settle(q, 'code-1', {status: 'added'}, now + 200);
  expect(nextCode(q, now + 4199)).toBeUndefined();
  expect(nextCode(q, now + 4200)).toBe('code-2');
});

it('backs off on 429 and transitions to failed after max attempts', () => {
  let q = initialQueueState();
  q = enqueue(q, 'rate-code');

  // Attempt 1
  q = begin(q, 'rate-code', 1000);
  q = settle(q, 'rate-code', {status: 'rate-limited', message: 'Busy'}, 1200);
  expect(q.items[0].status).toBe('rate-limited');
  expect(q.items[0].attempts).toBe(1);
  expect(q.nextAt).toBe(6200); // 1200 + 5000 backoff

  // Attempt 2
  q = begin(q, 'rate-code', 6500);
  q = settle(q, 'rate-code', {status: 'rate-limited', message: 'Busy'}, 6600);
  expect(q.items[0].status).toBe('rate-limited');
  expect(q.items[0].attempts).toBe(2);

  // Attempt 3
  q = begin(q, 'rate-code', 12000);
  q = settle(q, 'rate-code', {status: 'rate-limited', message: 'Busy'}, 12100);
  expect(q.items[0].status).toBe('failed');
  expect(q.items[0].message).toBe('Rate limit exceeded.');
});

it('calculates outstanding count and estimates 17 seconds for five fresh codes', () => {
  let q = initialQueueState();
  ['c1', 'c2', 'c3', 'c4', 'c5'].forEach(code => {
    q = enqueue(q, code);
  });
  expect(outstanding(q)).toBe(5);
  // Five fresh codes with 0 waitMs yields 17 seconds (0s, 4.2s, 8.4s, 12.6s, 16.8s -> 17s)
  expect(etaSeconds(5, 0)).toBe(17);
  expect(etaSeconds(0)).toBe(0);
});
