type PendingRead = { path: string; priority: number; start: (immediate?: boolean) => void };
let primaryReads = 0;
let optionalReadRunning = false;
let dispatchTimer: ReturnType<typeof setTimeout> | undefined;
const pendingReads: PendingRead[] = [];
const immediatePrefixes = new Set<string>();

function dispatch() {
  dispatchTimer = undefined;
  if (primaryReads || optionalReadRunning) return;
  pendingReads.sort((a, b) => a.priority - b.priority);
  pendingReads.shift()?.start();
}
function schedule() {
  if (!pendingReads.length) return;
  // Give the cache reader one event-loop turn to enqueue its provider refresh first.
  const delay = pendingReads.some(read => read.priority === 0) ? 0 : 200;
  dispatchTimer ??= setTimeout(dispatch, delay);
}
/** Immediately start reads matching prefix and bypass the optional launch queue until released. */
export function requestNow(prefix: string | string[]): () => void {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  for (const p of prefixes) immediatePrefixes.add(p);
  for (let i = pendingReads.length - 1; i >= 0; i--) {
    const read = pendingReads[i];
    if (prefixes.some(p => read.path.startsWith(p))) {
      pendingReads.splice(i, 1);
      read.start(true);
    }
  }
  return () => {
    for (const p of prefixes) immediatePrefixes.delete(p);
  };
}
/** Keep optional integration traffic behind session/bootstrap reads; writes never wait here. */
export async function coordinateLaunchRequest<T>(url: string, method: string, signal: AbortSignal | null | undefined,
  run: () => Promise<T>): Promise<T> {
  const path = url.split('?')[0];
  const primary = method === 'GET' && ['/api/auth/me', '/api/bootstrap', '/api/bootstrap/shell'].includes(path);
  if (primary) {
    primaryReads++;
    try { return await run(); }
    finally { primaryReads--; schedule(); }
  }
  const isImmediate = [...immediatePrefixes].some(prefix => path.startsWith(prefix));
  const priority = path.endsWith('/google-health/sync-data') ? 3
    : (path.endsWith('/google-health') || path.endsWith('/google-health/sync')) ? 0
    : method === 'GET' && ['/api/training/summary', '/api/integrations/connected'].includes(path) ? 1
    : method === 'GET' && ['/api/notifications/status', '/api/notifications/check-in-reminder'].includes(path) ? 2 : undefined;
  if (priority === undefined || isImmediate) return run();
  signal?.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      const index = pendingReads.indexOf(read);
      if (index >= 0) pendingReads.splice(index, 1);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
      schedule();
    };
    const read: PendingRead = { path, priority, start: (immediate = false) => {
      signal?.removeEventListener('abort', abort);
      if (immediate) {
        void run().then(resolve, reject);
      } else {
        optionalReadRunning = true;
        void run().then(resolve, reject).finally(() => { optionalReadRunning = false; schedule(); });
      }
    } };
    pendingReads.push(read);
    signal?.addEventListener('abort', abort, { once: true });
    schedule();
  });
}
