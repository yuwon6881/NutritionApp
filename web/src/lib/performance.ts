declare global {
  interface Window { __NUTRITION_PERFORMANCE__?: boolean }
}

let sequence = 0;
const completed: string[] = [];

/** Opt-in local diagnostics. Production never uploads timings or starts an observer. */
export function measurePerformance(operation: string): () => void {
  if (typeof window === 'undefined' || (!import.meta.env.DEV && !window.__NUTRITION_PERFORMANCE__)) return () => {};
  const start = `nutrition:${operation}:${++sequence}`;
  performance.mark(start);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const name = `nutrition:${operation}`;
    performance.measure(name, start);
    performance.clearMarks(start);
    completed.push(name);
    if (completed.length > 100) performance.clearMeasures(completed.shift());
  };
}
