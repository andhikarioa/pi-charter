/**
 * Build the compiled package and record the identity of the artifact set it emitted (H1).
 *
 * Emitting JavaScript is not enough: a receipt must commit to the identity of the compiler artifact
 * that actually ran, so the build finishes by digesting exactly what it produced and recording that
 * digest at the package root. A test run over `dist` therefore sees a real build identity, and a
 * changed artifact set produces a different one.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', resolve(root, 'tsconfig.build.json')],
  { stdio: 'inherit', cwd: root },
);

/**
 * Declaration files must reference the EMITTED modules, not the sources they were compiled from.
 * Source specifiers keep the `.ts` extension (so the sources stay directly runnable), and
 * `rewriteRelativeImportExtensions` rewrites them in the emitted JavaScript but not in the emitted
 * declarations — so the declaration pass is finished here, before the artifact set is digested.
 */
const rewriteDeclarations = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteDeclarations(path);
      continue;
    }
    if (!entry.name.endsWith('.d.ts')) continue;
    const source = readFileSync(path, 'utf8');
    const rewritten = source.replace(/((?:from|import\()\s*["'])(\.\.?\/[^"']+)\.ts(["'])/g, '$1$2.js$3');
    if (rewritten !== source) writeFileSync(path, rewritten, 'utf8');
  }
};
rewriteDeclarations(dist);

const { writeCompilerIdentity } = await import(new URL('../dist/build/compiler-identity.js', import.meta.url).href);
console.log(`pi-charter build identity: ${writeCompilerIdentity(dist)}`);
