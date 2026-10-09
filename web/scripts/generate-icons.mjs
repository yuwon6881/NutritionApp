import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  // Fall back to workspace sibling if sharp is not in local web/node_modules
  const workspaceRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../FinancialApp/node_modules/sharp');
  sharp = require(workspaceRoot);
}

// The mark is one continuous rounded stroke on the 192 grid: up the left stem, down an eased trend
// curve, and up the right stem, so the N also reads as a falling trend line. Keep MARK_PATH and
// MARK_STROKE in step with components/ui/Brand.tsx. Every web and Android icon is written from here.
const MARK_PATH = 'M62 130V62C100 62 92 130 130 130V62';
const MARK_STROKE = 24;
const TILE = '#000000';
const INK = '#ffffff';
// The mark spans 54% of a web or iOS tile (its raw extent is 48%), the same optical size as the
// sibling apps' icons (Financial, Workout, Calendar), so the four sit evenly on a home screen. The
// Android adaptive vectors below are already sized to match the launcher.
const TILE_SCALE = 1.13;

const markAt = scale =>
  `<g transform="translate(96 96) scale(${scale}) translate(-96 -96)"><path d="${MARK_PATH}" fill="none" stroke="${INK}" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
const canvas = (body, size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="${size}" height="${size}">${body}</svg>`;

// Square tiles are masked by the platform (maskable PWA, iOS, Android adaptive); "any" icons carry their own corners.
const square = `<rect width="192" height="192" fill="${TILE}"/>`;
const rounded = `<rect width="192" height="192" rx="43" fill="${TILE}"/>`;
const circle = `<circle cx="96" cy="96" r="96" fill="${TILE}"/>`;

const anyIcon = canvas(rounded + markAt(TILE_SCALE));
// The maskable safe zone is a centred circle of radius 76.8; the mark's farthest edge sits at 73.
const maskableIcon = canvas(square + markAt(TILE_SCALE));
const legacyRound = canvas(circle + markAt(TILE_SCALE * 0.92));
// Android notification badges use only the alpha channel, so the badge is the bare mark.
const badge = canvas(markAt(1.7));

const jobs = [
  [anyIcon, 192, 'public/icon-192.png'],
  [anyIcon, 512, 'public/icon-512.png'],
  [maskableIcon, 512, 'public/icon-maskable-512.png'],
  [maskableIcon, 180, 'public/apple-touch-icon.png'],
  [badge, 96, 'public/badge-96.png'],
];

// Pre-adaptive launchers (API 24–25) use 48 dp bitmaps; API 26+ use the adaptive vectors below.
const res = 'android/app/src/main/res';
for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  jobs.push([anyIcon, size, `${res}/mipmap-${density}/ic_launcher.png`], [legacyRound, size, `${res}/mipmap-${density}/ic_launcher_round.png`]);
}

for (const [source, size, out] of jobs) {
  // The artwork is greyscale, so a palette PNG is lossless to the eye and keeps the PWA precache small.
  await sharp(Buffer.from(source)).resize(size, size).png({ palette: true, compressionLevel: 9, effort: 10 }).toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

writeFileSync('public/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">${rounded}${markAt(TILE_SCALE)}</svg>\n`);
console.log('wrote public/icon.svg');

const vector = (dp, scale) => `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp"
    android:height="${dp}dp"
    android:viewportWidth="192"
    android:viewportHeight="192">
    <group
        android:pivotX="96"
        android:pivotY="96"
        android:scaleX="${scale}"
        android:scaleY="${scale}">
        <path
            android:pathData="${MARK_PATH}"
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="${MARK_STROKE}"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
    </group>
</vector>
`;
// Adaptive launcher, splash, and themed-icon foreground: 108 dp on the 192 grid. The launcher safe
// zone is a 66 dp circle (radius 58.7 here); at 0.74 the mark's farthest edge sits at 44.5.
writeFileSync(`${res}/drawable/nutrition_launcher_foreground.xml`, vector(108, 0.74));
// Status-bar notification icon: the bare mark inside the 20 dp live area of a 24 dp canvas.
writeFileSync(`${res}/drawable/ic_stat_nutrition_notification.xml`, vector(24, 1.74));
console.log('wrote Android launcher and notification vectors');
