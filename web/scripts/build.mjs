import { build } from 'vite';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// VitePWA finishes the bundle but can leave a Workbox/esbuild handle alive on
// Windows. The build promise has completed at this point, so explicitly end
// the short-lived build process instead of making container builds hang.
await build();

// Mobile budgets: what a phone downloads on a cold start over mobile data.
// The first load is the entry script plus every chunk index.html preloads with it.
const KIB = 1024;
const budgets = { firstLoad: 430 * KIB, precache: 1150 * KIB };
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const size = path => statSync(join(dist, path)).size;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/<script[^>]+src="\/(assets\/index-[^"]+\.js)"/)?.[1];
const preloads = [...html.matchAll(/rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(match => match[1]);
const precached = [...readFileSync(join(dist, 'sw.js'), 'utf8').matchAll(/"?url"?:\s*"([^"]+)"/g)].map(match => match[1]);
const precacheBytes = precached.reduce((total, path) => { try { return total + size(path); } catch { return total; } }, 0);

const failures = [];
if (!entry) failures.push('Could not find the entry script in dist/index.html.');
else {
  const firstLoad = [entry, ...preloads].reduce((total, path) => total + size(path), 0);
  console.log(`Mobile budgets: first load ${Math.round(firstLoad / KIB)} of ${budgets.firstLoad / KIB} KiB (entry ${Math.round(size(entry) / KIB)} KiB + ${preloads.length} preloaded chunks); precache ${Math.round(precacheBytes / KIB)} of ${budgets.precache / KIB} KiB across ${precached.length} files.`);
  if (firstLoad > budgets.firstLoad) failures.push(`First-load JavaScript exceeds its ${budgets.firstLoad / KIB} KiB budget.`);
}
if (!precached.length) failures.push('Could not read the service worker precache list.');
if (precacheBytes > budgets.precache) failures.push(`Precache exceeds its ${budgets.precache / KIB} KiB budget.`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
process.exit(0);
