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

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="1024" height="1024">
  <rect width="192" height="192" fill="#0b0e14" />
  <path d="M50 137V55h20l52 61V55h20v82h-20L70 76v61z" fill="#ffffff" />
  <circle cx="147" cy="40" r="14" fill="#ffffff" />
</svg>`;

const jobs = [
  [192, 'public/icon-192.png'],
  [512, 'public/icon-512.png'],
];

for (const [size, out] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}
