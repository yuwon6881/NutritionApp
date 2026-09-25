import { createRequire } from 'module';
import { fileURLToPath } from 'url';
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

// The mark is the N alone, centred on the 192 grid. Keep it in step with
// components/ui/Brand.tsx, public/icon.svg, and the Android launcher vector.
const mark = `<path d="M50 137V55h20l52 61V55h20v82h-20L70 76v61z" fill="#ffffff" />`;
const plate = '<rect width="192" height="192" fill="#0b0e14" />';
const canvas = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="1024" height="1024">${body}</svg>`;

const svg = canvas(plate + mark);
// Launchers crop maskable icons to as little as the central 80% circle; the
// slightly smaller mark keeps comfortable margin inside it.
const maskableSvg = canvas(`${plate}<g transform="translate(96 96) scale(0.86) translate(-96 -96)">${mark}</g>`);
// Legacy (pre-adaptive, API 24–25) Android launcher icons.
const roundSvg = canvas(`<circle cx="96" cy="96" r="96" fill="#0b0e14" />${mark}`);
const foregroundSvg = canvas(mark);

const res = 'android/app/src/main/res';
const densities = [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]];

const jobs = [
  [svg, 192, 'public/icon-192.png'],
  [svg, 512, 'public/icon-512.png'],
  [maskableSvg, 512, 'public/icon-maskable-512.png'],
  ...densities.flatMap(([density, foregroundSize]) => [
    [svg, 512, `${res}/mipmap-${density}/ic_launcher.png`],
    [roundSvg, 512, `${res}/mipmap-${density}/ic_launcher_round.png`],
    [foregroundSvg, foregroundSize, `${res}/mipmap-${density}/ic_launcher_foreground.png`],
  ]),
];

for (const [source, size, out] of jobs) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}
