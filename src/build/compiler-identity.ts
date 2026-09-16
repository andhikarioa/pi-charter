/**
 * Compiler build identity (v0.1.1 Wave 2 — H1 final).
 *
 * Wave 1 created the requirement: a `ResolutionReceipt` must commit to the identity of the compiler
 * artifact that ran resolution, and that identity must not be a restatement of the product version.
 * Wave 1 deliberately refused to invent one. Wave 2 supplies the real thing:
 *
 *   compiler_identity = SHA-256 over the defined compiled artifact set (`dist/**` `.js` + `.d.ts`)
 *
 * Properties, both directly testable:
 *
 *   same build artifact             → same compiler identity
 *   material compiled artifact change → different compiler identity
 *
 * It is NOT: an operator-typed string, a hardcoded SHA, a date-based label, and not the package
 * version wearing an artifact identity's clothes. `npm run build` compiles the package and then
 * writes the digest it computed over exactly those emitted files into `compiler-identity.json` at the
 * package root, so the identity always describes the artifact set that was actually built.
 *
 * The file is read at resolution time and nothing else is: no clock, no Git, no environment, no
 * network. A missing build identity is reported as missing — the facade refuses rather than
 * fabricating one.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where `npm run build` records the identity of the artifact set it emitted. */
export const COMPILER_IDENTITY_FILE = 'compiler-identity.json';

/** The compiled artifact extensions the identity is taken over. Source and tests are not artifacts. */
const ARTIFACT_EXTENSIONS = ['.js', '.d.ts'] as const;

/** The package root, resolved identically from `src/build/` and from `dist/build/`. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every compiled artifact under `dir`, as `/`-separated paths relative to it, sorted. Sorting makes
 * the digest independent of directory-enumeration order.
 */
export function listCompiledArtifacts(dir: string): string[] {
  const artifacts: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const relativePath = relative(dir, path).split(sep).join('/');
      if (ARTIFACT_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) artifacts.push(relativePath);
    }
  };
  walk(resolve(dir));
  return artifacts.sort();
}

/**
 * Deterministic digest over the artifact set: SHA-256 over `path\0content-digest` per artifact, sorted
 * by path. Content digests keep the identity stable against anything but an actual artifact change.
 */
export function computeCompilerIdentity(dir: string): string {
  const hash = createHash('sha256');
  for (const relativePath of listCompiledArtifacts(dir)) {
    const content = createHash('sha256')
      .update(readFileSync(resolve(dir, relativePath)))
      .digest('hex');
    hash.update(`${relativePath}\0${content}\0`);
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Compute the identity of the artifact set under `dir` and record it at the package root. Called by
 * `npm run build` after compilation, with `dir` the directory that was just emitted.
 */
export function writeCompilerIdentity(dir: string): string {
  const compilerIdentity = computeCompilerIdentity(dir);
  const record = { compiler_identity: compilerIdentity, artifacts: listCompiledArtifacts(dir).length };
  writeFileSync(resolve(PACKAGE_ROOT, COMPILER_IDENTITY_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return compilerIdentity;
}

/**
 * The identity of the compiler artifact set this process is running from, fail-closed.
 *
 * Absent or malformed means the package was never built: that is reported as the reason, never
 * papered over with a fallback identity.
 */
export function readCompilerIdentity(): { ok: true; compiler_identity: string } | { ok: false; reason: string } {
  let raw: string;
  try {
    raw = readFileSync(resolve(PACKAGE_ROOT, COMPILER_IDENTITY_FILE), 'utf8');
  } catch {
    return { ok: false, reason: `no compiled build identity at ${COMPILER_IDENTITY_FILE}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `${COMPILER_IDENTITY_FILE} is not valid JSON` };
  }
  const identity = (parsed as { compiler_identity?: unknown } | null)?.compiler_identity;
  if (typeof identity !== 'string' || identity.trim().length === 0) {
    return { ok: false, reason: `${COMPILER_IDENTITY_FILE} carries no compiler identity` };
  }
  return { ok: true, compiler_identity: identity };
}
