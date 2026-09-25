import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'web/src');
const allowedLargeFiles = new Set([
  'web/src/components/Coach.tsx',
  'web/src/components/ui/DatePicker.tsx',
  'web/src/index.css'
]);
const failures = [];

// Hover styles stick after a tap on touch screens; they belong behind a hover-capable media query.
function ungatedHoverSelectors(css) {
  const found = [];
  const stack = [];
  let prelude = '';
  for (let index = 0; index < css.length; index += 1) {
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 1;
      continue;
    }
    const char = css[index];
    if (char === '{') {
      const text = prelude.trim();
      const insideKeyframes = stack.some(entry => entry.startsWith('@keyframes'));
      const gated = stack.some(entry => entry.startsWith('@media') && /hover\s*:\s*hover/.test(entry));
      if (text.includes(':hover') && !text.startsWith('@') && !insideKeyframes && !gated) found.push(text);
      stack.push(text);
      prelude = '';
    } else if (char === '}') {
      stack.pop();
      prelude = '';
    } else if (char === ';') {
      prelude = '';
    } else {
      prelude += char;
    }
  }
  return found;
}

// Phones need a hint to show a number pad; raw inputs do not get Field's default.
function numberInputsWithoutInputMode(source) {
  const found = [];
  let start = source.indexOf('<input');
  while (start >= 0) {
    let depth = 0;
    let end = start;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0 && source[end - 1] !== '=') break;
    }
    const tag = source.slice(start, end + 1);
    if (/type=["']number["']/.test(tag) && !/inputMode=/.test(tag)) found.push(tag.replace(/\s+/g, ' '));
    start = source.indexOf('<input', end);
  }
  return found;
}

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
  if (extension === '.css') {
    for (const selector of ungatedHoverSelectors(content)) failures.push(`${normalized} has :hover outside @media (hover:hover): ${selector.slice(0, 80)}`);
  }
  if (extension === '.tsx') {
    for (const tag of numberInputsWithoutInputMode(content)) failures.push(`${normalized} has a number input without inputMode: ${tag.slice(0, 80)}`);
  }
  if (normalized.includes('/components/ui/') && /addEventListener\(\s*['"]mousedown['"]/.test(content)) {
    failures.push(`${normalized} dismisses on mousedown; use useDismissablePopover so touch dismisses too.`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Documentation, component reuse, colors, source-size, hover, numeric-input, and dismissal standards pass.');
