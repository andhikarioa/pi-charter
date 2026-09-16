/**
 * Compiler build identity (v0.1.1 Wave 2 — H1; final correction — F2).
 *
 * Wave 1 created the requirement: a `ResolutionReceipt` must commit to the identity of the compiler
 * artifact that ran resolution, and that identity must not be a restatement of the product version.
 * Wave 1 deliberately refused to invent one. Wave 2 supplies the real thing:
 *
 *   compiler_identity = SHA-256 over the defined shipped runtime artifact set
 *                       (`dist/**` `.js` plus `.d.ts`, minus test artifacts)
 *
 * Properties, all directly testable:
 *
 *   same build artifact              → same compiler identity
 *   material runtime artifact change → different compiler identity
 *   tampered artifact + stale record → COMPILER_IDENTITY_MISMATCH, compilation refused
 *
 * It is NOT: an operator-typed string, a hardcoded SHA, a date-based label, and not the package
 * version wearing an artifact identity's clothes. `npm run build` compiles the package and then
 * writes the digest it computed over exactly those emitted files into `compiler-identity.json` at the
 * package root, so the identity always describes the artifact set that was actually built.
 *
 * The final correction closes the stale-record hole: reading the identity RECOMPUTES the digest of
 * the artifact set this process is actually executing and compares it with the recorded one. A
 * modified runtime artifact therefore cannot keep using an identity that was computed before the
 * modification — the record is an expectation to verify, never an authority to trust.
 *
 * The artifact set is deterministic and local: `.js` and `.d.ts` under `dist`, test artifacts
 * excluded exactly as `package.json` excludes them from the shipped package, sorted by relative path,
 * hashed per content. No clock, no Git, no environment, no network, and the record file itself is
 * never part of the set. A missing or mismatched build identity is reported — the facade refuses
 * rather than fabricating or silently regenerating one.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where `npm run build` records the identity of the artifact set it emitted. */
export const COMPILER_IDENTITY_FILE = 'compiler-identity.json';

/** The compiled artifact extensions the identity is taken over. Source and tests are not artifacts. */
const ARTIFACT_EXTENSIONS = ['.js', '.d.ts'] as const;

/**
 * Artifacts excluded from the shipped/runtime set. These are exactly the exclusions `package.json`
 * applies to `dist` in `files`: a test artifact is not part of the runtime package, so it neither
 * defines the runtime identity nor can a change to it invalidate a legitimate build.
 */
const EXCLUDED_ARTIFACT_SUFFIXES = ['.test.js', '.test.d.ts'] as const;

/** The package root, resolved identically from `src/build/` and from `dist/build/`. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The runtime artifact root this process executes from, resolved identically from `src/` and `dist/`. */
const RUNTIME_ARTIFACT_ROOT = resolve(PACKAGE_ROOT, 'dist');

/**
 * Every shipped/runtime compiled artifact under `dir`, as `/`-separated paths relative to it, sorted.
 * Sorting makes the digest independent of directory-enumeration order; test-only artifacts are
 * excluded because they are not part of the runtime package artifact set.
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
      if (!ARTIFACT_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) continue;
      if (EXCLUDED_ARTIFACT_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue;
      artifacts.push(relativePath);
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

/** Where `readCompilerIdentity` looks by default, injectable so a tampered copy can be probed. */
export interface CompilerIdentitySource {
  /** Directory holding the compiled artifact set actually executing (default: `dist/`). */
  artifactsDir?: string;
  /** Path of the recorded identity to verify (default: `<package root>/compiler-identity.json`). */
  recordPath?: string;
}

/**
 * The identity of the compiler artifact set this process is running from, fail-closed.
 *
 * The recorded identity is an EXPECTATION: it is verified against the current digest of the artifact
 * set being executed. Absent, malformed, or stale means compilation is refused — a missing record is
 * never papered over with a fallback identity, and a mismatched record is never silently regenerated,
 * because a modified artifact must require an explicit rebuild before compilation can succeed.
 */
export function readCompilerIdentity(source: CompilerIdentitySource = {}):
  | { ok: true; compiler_identity: string }
  | { ok: false; reason: string } {
  const artifactsDir = source.artifactsDir ?? RUNTIME_ARTIFACT_ROOT;
  const recordPath = source.recordPath ?? resolve(PACKAGE_ROOT, COMPILER_IDENTITY_FILE);
  let raw: string;
  try {
    raw = readFileSync(recordPath, 'utf8');
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
  // The record is verified against what is actually executing. A stale record (the artifact set
  // changed after the build) is reported, not trusted and not regenerated.
  let current: string;
  try {
    current = computeCompilerIdentity(artifactsDir);
  } catch {
    return { ok: false, reason: `the runtime compiler artifact set is not readable at ${COMPILER_IDENTITY_FILE}'s package` };
  }
  if (current !== identity) {
    return {
      ok: false,
      reason: `COMPILER_IDENTITY_MISMATCH: ${COMPILER_IDENTITY_FILE} records ${identity} but the executing ${artifactsDir} artifact set digests to ${current}; rebuild before compiling`,
    };
  }
  return { ok: true, compiler_identity: identity };
}
