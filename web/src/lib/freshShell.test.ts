import { describe, expect, it, vi } from 'vitest';
import { reloadWithFreshShell } from './freshShell';

describe('reloadWithFreshShell', () => {
  it('calls reload after clearing caches or settling limit', async () => {
    const reload = vi.fn();
    await reloadWithFreshShell(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
