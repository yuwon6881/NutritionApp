import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'web/src');
const allowedLargeFiles = new Set([
  'web/src/components/Coach.tsx',
  'web/src/components/LogFood.tsx',
  'web/src/components/ui/DatePicker.tsx',
  'web/src/index.css'
]);
const failures = [];

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

const docs = ['CLAUDE.md', 'AGENTS.md'].map(file => readFileSync(resolve(root, file)));
if (!docs[0].equals(docs[1])) failures.push('AGENTS.md must be byte-identical to CLAUDE.md.');
if (docs[0].toString().split(/\r?\n/).length > 110) failures.push('Repository guidance must remain at or below 110 lines.');

for (const file of filesIn(sourceRoot)) {
  const extension = extname(file);
  if (!['.ts', '.tsx', '.css'].includes(extension)) continue;
  const normalized = relative(root, file).replaceAll('\\', '/');
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/).length;
  if (lines > 500 && !allowedLargeFiles.has(normalized)) failures.push(`${normalized} has ${lines} lines (limit: 500).`);
  if (extension === '.tsx' && !normalized.includes('/components/ui/') && /<button(?:\s|>)/.test(content)) {
    failures.push(`${normalized} renders a raw button outside the shared UI layer.`);
  }
  if (extension === '.tsx' && /#[0-9a-f]{3,8}\b/i.test(content)) failures.push(`${normalized} contains a hard-coded color.`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Documentation, component reuse, colors, and source-size standards pass.');
