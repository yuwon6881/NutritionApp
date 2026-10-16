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
// Include identity-safe retained writes, Body request checkpoints, and canonical sync recovery in the offline allowance.
// Allow the weigh-in confirmation, themed Undo surface, AI photo controls, workout summary polish, weight goal card, goal history card uplift, session-expiry sign-in handling, day options menu, food action sheet, month-paged habit calendars, Energy period totals, lease-owner sync recovery, weekly scheduled workouts, the trend-aware weigh-in baseline, thirty-day habit grids, the three-part Dashboard energy card, the Food Log day targets with phone timeline cards, the Dashboard week-against-targets and weight-trend insights, and the Lavender / Midnight Lime redesign (page-shaped loading skeletons, top-layer select menus that cards cannot clip, and the stable Food Log day strip and status) with Coach targets and weekly budget layout polish, coach edit plan modal, batch food swipe refinement, and the time-of-day food picks with aligned timeline macro columns in the offline bundle.
// Shared retained-draft attachment and capability dispatch add a small offline allowance;
// Android-only surfaces are excluded from the PWA precache and ship directly in the APK.
// The g/ml measure carried through food search, review, the diary, and saved foods adds a small allowance;
// dialog-anchored custom select alignment adds a small allowance.
// Page-shaped loading placeholders and the Dashboard steps chip with its lazily loaded details add a small allowance.
// Tap-to-edit food cards, midnight date navigation, goal parity, and portion wording add a small offline allowance.
const budgets = { firstLoad: 471 * KIB, precache: 1296 * KIB };
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
