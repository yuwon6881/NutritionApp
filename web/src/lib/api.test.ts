import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {api,apiWithMeta,clearApiCooldowns} from './api';

describe('rate limit recovery',()=>{
  beforeEach(()=>{clearApiCooldowns();vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-27T00:00:00Z'));});
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();clearApiCooldowns();});

  it('exposes Retry-After and suppresses retries across the food lookup policy',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({message:'Please wait.'}),{status:429,headers:{'Retry-After':'10'}}))
      .mockResolvedValueOnce(new Response('[]',{status:200}));
    vi.stubGlobal('fetch',fetch);
    await expect(api('/foods/search?q=rice')).rejects.toMatchObject({status:429,retryAfterMs:10000,retryAt:Date.now()+10000});
    await expect(apiWithMeta('/foods/barcode/123')).rejects.toMatchObject({status:429});
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    await expect(api('/foods/search?q=rice')).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reads HTTP-date Retry-After and clears client cooldowns on account changes',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':new Date(Date.now()+30000).toUTCString()}}))
      .mockResolvedValueOnce(new Response('{}',{status:200}));
    vi.stubGlobal('fetch',fetch);
    await expect(apiWithMeta('/progress/summary?period=week')).rejects.toMatchObject({retryAfterMs:30000});
    await expect(api('/progress/summary?period=all')).rejects.toMatchObject({status:429});
    clearApiCooldowns();
    await expect(api('/progress/summary?period=all')).resolves.toEqual({});
  });
});
