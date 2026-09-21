import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {retryAppServiceWorkerRegistration,waitForAppServiceWorker} from './registerAppServiceWorker';

function installBrowser(serviceWorker:ServiceWorkerContainer){
  vi.stubGlobal('window',{
    setTimeout:globalThis.setTimeout.bind(globalThis),
    clearTimeout:globalThis.clearTimeout.bind(globalThis),
    addEventListener:vi.fn(),
    removeEventListener:vi.fn()
  });
  vi.stubGlobal('document',{readyState:'complete'});
  vi.stubGlobal('navigator',{serviceWorker});
}

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('service worker readiness',()=>{
  it('returns a visible registration error instead of swallowing failure',async()=>{
    const serviceWorker={
      register:vi.fn().mockRejectedValue(new Error('registration denied')),
      ready:Promise.resolve({} as ServiceWorkerRegistration)
    } as unknown as ServiceWorkerContainer;
    installBrowser(serviceWorker);

    await expect(retryAppServiceWorkerRegistration(50)).rejects.toThrow('Offline features could not start: registration denied');
  });

  it('bounds the notification setup wait when service worker readiness never resolves',async()=>{
    const registration={} as ServiceWorkerRegistration;
    const serviceWorker={
      register:vi.fn().mockResolvedValue(registration),
      ready:new Promise<ServiceWorkerRegistration>(()=>{})
    } as unknown as ServiceWorkerContainer;
    installBrowser(serviceWorker);

    const waiting=waitForAppServiceWorker(50);
    const assertion=expect(waiting).rejects.toThrow('App notifications are taking too long to set up.');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
