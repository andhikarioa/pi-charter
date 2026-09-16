/**
 * Run the compiled test files under `dist` (U3).
 *
 * The official test path must not depend on an accidental runtime's ability to execute TypeScript,
 * and it must not depend on shell glob expansion either: the file list is walked and passed to
 * `node --test` explicitly, which behaves identically on every supported Node release.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.test.js')) files.push(path);
  }
};
walk(dist);
files.sort();

if (files.length === 0) {
  console.error('no compiled test files under dist; run npm run build first');
  process.exit(1);
}

execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
