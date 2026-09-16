/**
 * Operator-facing compile request (v0.1.2 Wave 1 — CN0).
 *
 * The dogfood finding: from Pi, compiling bounded authority required the operator to hand-author the
 * full internal `TaskContract` AND construct a binder object with a document identity and a revision
 * string. Both are Charter's own representation, and neither is something the operator knows or should
 * need to know. The result was that normal delegation intent became source archaeology.
 *
 * This module is the one normalization step between normal operator intent and the strict canonical
 * contract:
 *
 *   simple input  (task, role, target, authority document, scope, fresh, gates)
 *        ↓  normalizeOperatorRequest
 *   canonical TaskContract + authority binder
 *        ↓  resolveExecutionContract / compileForTarget   ← unchanged, still strict
 *   compiled governance
 *
 * The normalization adds nothing to Charter's authority. It FILLS the deterministic fields core
 * requires (task identity, class, risk, verification level, role-derived permissions) with values a
 * reader can see, and it resolves the operator's authority DOCUMENT reference into a binder candidate
 * from local truth. Everything governance-bearing that the operator did not state stays unstated, so
 * core refuses it: nothing here defaults a scope, invents an authority source, guesses a model, or
 * repairs a contradiction.
 *
 * The authority document is resolved mechanically and fails closed:
 *
 *   0 candidates  → AUTHORITY_UNRESOLVED (no such document under the declared root)
 *   escaping path → AUTHORITY_UNRESOLVED (a root-relative document is all this surface admits)
 *   unreadable    → AUTHORITY_UNRESOLVED (a document that cannot be read grounds no identity)
 *
 * There is no directory scan, no fuzzy filename match, no newest-wins choice: an ambiguous lookup is
 * not something this surface can even express, and a name that resolves to nothing is a refusal with
 * a remedy rather than a best effort. The bound content is the document text, so the provenance digest
 * core records IS the identity of the authority content the compile ran on.
 *
 * The advanced path is unchanged and still available: a caller that already has a canonical contract
 * passes `task_contract` and the exact binder evidence. The evidence spelling is `authority_evidence`,
 * and the sealed v0.1.1 spelling `authority: { source, doc, revision? }` beside `task_contract` remains
 * a compatibility alias for it: an invocation that worked against the released Pi tool surface still
 * works, because a public tool schema is a contract and this release is a UX patch, not a break.
 * Neither path weakens core validation — both end at the same Phase 1 contract validator.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type { AuthorityBinder } from '../core/authority/binder.ts';
import { createAuthorityBinder } from '../core/authority/binder.ts';
import type { CharterError, CharterErrorCode } from '../core/contracts/errors.ts';
import {
  EXECUTION_TARGETS,
  ROLES,
  ROLE_REPOSITORY_WRITES,
  type Acceptance,
  type ExecutionTargetName,
  type Permissions,
  type Risk,
  type Role,
  type Scope,
  type TaskClass,
  type TaskContract,
} from '../core/contracts/task-contract.ts';
import { createEvidenceBinder } from '../core/provenance/evidence.ts';
import type { DelegationFreshContext } from '../delegation/compile-delegation.ts';

/** The fresh-context vocabulary as the operator states it: lowercase, and exactly two values. */
export const OPERATOR_FRESH_VALUES = ['required', 'not_required'] as const;
export type OperatorFreshValue = (typeof OPERATOR_FRESH_VALUES)[number];

/** Task class and risk the simple surface declares when the operator states neither. */
export const OPERATOR_DEFAULT_TASK_CLASS: TaskClass = 'T1';
export const OPERATOR_DEFAULT_RISK: Risk = 'low';
/** Verification level the simple surface declares: V1 — focused tests (spec §19). */
export const OPERATOR_DEFAULT_VERIFICATION_LEVEL = 'V1' as const;

/** The fields the operator-facing compile accepts. Anything else fails closed. */
const OPERATOR_KEYS = [
  'task',
  'role',
  'target',
  'authority',
  'scope',
  'root',
  'fresh',
  'gates',
  'task_contract',
  'authority_evidence',
] as const;

const AUTHORITY_EVIDENCE_KEYS = ['source', 'doc', 'revision'] as const;

export interface NormalizedOperatorRequest {
  /** Which surface produced this request. Both end at the same canonical validation. */
  request_kind: 'simple' | 'advanced';
  /** The canonical Phase 1 contract, ready to be resolved. */
  task_contract: TaskContract;
  /** The authority reference the contract declares, exactly as the contract declares it. */
  authority_reference: string;
  /** The binder that reference resolves under. Built here, never supplied as a raw object. */
  authority_binder: AuthorityBinder;
  /** Set only for a simple request that named a local authority document. */
  authority_document?: { reference: string; path: string };
  /**
   * The delegation dispatch requirement the operator stated, normalized. `NOT_REQUIRED` is the
   * absence of a requirement, never an observation that a fresh session happened.
   */
  fresh_context: DelegationFreshContext;
}

export type OperatorRequestResult =
  | { ok: true; request: NormalizedOperatorRequest }
  | { ok: false; errors: CharterError[] };

export interface OperatorRequestEnv {
  /** The session working directory. The root defaults to it and authority documents resolve under it. */
  cwd: string;
}

/**
 * Normalize normal operator intent into the canonical internal contract, or refuse.
 *
 * Deterministic and fail-closed: the same intent and environment always produce the same contract and
 * the same authority binder, and an input that cannot be normalized produces the exact reason instead
 * of a partially-filled contract.
 */
export function normalizeOperatorRequest(input: unknown, env: OperatorRequestEnv): OperatorRequestResult {
  const errors: CharterError[] = [];
  const err = (code: CharterErrorCode, path: string, message: string): void => {
    errors.push({ code, message, path });
  };
  if (!isRecord(input)) {
    return refuse('', 'the compile request must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!(OPERATOR_KEYS as readonly string[]).includes(key)) err('INVALID_TASK_CONTRACT', key, `unknown field '${key}'`);
  }
  if (typeof env?.cwd !== 'string' || env.cwd.trim().length === 0) {
    return refuse('root', 'the compile environment must supply the session working directory as `cwd`');
  }
  // The v0.1.1 advanced spelling: `authority` as the evidence OBJECT beside `task_contract`. An
  // object-valued authority is never simple intent (the simple field is a document path string), so it
  // is resolved deterministically as the legacy alias of `authority_evidence` rather than rejected by
  // the pre-validation schema the way it was when `authority` was declared a string outright.
  const legacyAuthority = isRecord(input.authority) ? input.authority : undefined;
  if (input.authority !== undefined && !isNonEmptyString(input.authority) && legacyAuthority === undefined) {
    err(
      'INVALID_TASK_CONTRACT',
      'authority',
      'authority must be the authority document path (a string), or the v0.1.1 evidence object { source, doc, revision? } beside task_contract',
    );
  }
  if (input.task_contract !== undefined && hasSimpleIntent(input)) {
    return refuse(
      '',
      'task_contract (the advanced canonical path) and the simple intent fields are both present; state one of them, because a request is never half-normalized and half-authored',
    );
  }
  if (input.authority_evidence !== undefined && input.task_contract === undefined) {
    return refuse(
      'authority_evidence',
      'authority_evidence is the advanced form and binds a reference the contract itself declares; pass it together with task_contract, or state the simple fields (authority is then the document path)',
    );
  }
  if (legacyAuthority !== undefined && input.task_contract === undefined) {
    return refuse(
      'authority',
      'the authority evidence object is the advanced form and binds a reference the contract itself declares; pass it together with task_contract, or state the simple authority document path as a string',
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  if (input.task_contract !== undefined) return normalizeAdvanced(input, err, errors);
  return normalizeSimple(input, env, err, errors);

  function refuse(path: string, message: string): OperatorRequestResult {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path, message }] };
  }
}

/**
 * True when the request states at least one of the simple intent fields. An object-valued `authority`
 * is the v0.1.1 advanced evidence spelling, not simple intent, so it does not count here.
 */
function hasSimpleIntent(input: Record<string, unknown>): boolean {
  return (
    input.task !== undefined ||
    input.role !== undefined ||
    input.target !== undefined ||
    (input.authority !== undefined && !isRecord(input.authority)) ||
    input.scope !== undefined ||
    input.root !== undefined ||
    input.fresh !== undefined ||
    input.gates !== undefined
  );
}

/**
 * The advanced path: a canonical contract plus the exact binder evidence for one declared reference.
 * Nothing is normalized, nothing is filled in, and the caller's contract is validated by core exactly
 * as before this module existed. The evidence is stated as `authority_evidence`, or — unchanged from
 * the released v0.1.1 tool schema — as the `authority` object beside `task_contract`.
 */
function normalizeAdvanced(
  input: Record<string, unknown>,
  err: (code: CharterErrorCode, path: string, message: string) => void,
  errors: CharterError[],
): OperatorRequestResult {
  if (isRecord(input.authority) && input.authority_evidence !== undefined) {
    return {
      ok: false,
      errors: [
        {
          code: 'AUTHORITY_UNRESOLVED',
          path: 'authority_evidence',
          message:
            'the advanced path binds ONE evidence object: state authority_evidence, or its v0.1.1 alias `authority` beside task_contract, never both',
        },
      ],
    };
  }
  const evidencePath = isRecord(input.authority) ? 'authority' : 'authority_evidence';
  const evidence = isRecord(input.authority) ? input.authority : input.authority_evidence;
  if (!isRecord(evidence)) {
    return {
      ok: false,
      errors: [
        {
          code: 'AUTHORITY_UNRESOLVED',
          path: evidencePath,
          message:
            `the advanced path states the contract itself, so it must also state the authority evidence { source, doc, revision? } (as ${evidencePath}) that contract's authority.sources reference binds to`,
        },
      ],
    };
  }
  for (const key of Object.keys(evidence)) {
    if (!(AUTHORITY_EVIDENCE_KEYS as readonly string[]).includes(key)) {
      err('AUTHORITY_UNRESOLVED', `${evidencePath}.${key}`, `unknown field '${evidencePath}.${key}'`);
    }
  }
  const source = evidence.source;
  const doc = evidence.doc;
  if (!isNonEmptyString(source)) {
    err('AUTHORITY_UNRESOLVED', `${evidencePath}.source`, `${evidencePath}.source must name the contract authority reference it binds`);
  }
  if (!isNonEmptyString(doc)) {
    err('AUTHORITY_UNRESOLVED', `${evidencePath}.doc`, `${evidencePath}.doc must identify the exact authority content`);
  }
  if (evidence.revision !== undefined && !isNonEmptyString(evidence.revision)) {
    err('AUTHORITY_UNRESOLVED', `${evidencePath}.revision`, `${evidencePath}.revision must be a non-empty revision identity when stated`);
  }
  if (errors.length > 0) return { ok: false, errors };
  const reference = (source as string).trim();
  return {
    ok: true,
    request: {
      request_kind: 'advanced',
      task_contract: input.task_contract as TaskContract,
      authority_reference: reference,
      authority_binder: createAuthorityBinder({
        [reference]: {
          doc: (doc as string).trim(),
          ...(isNonEmptyString(evidence.revision) ? { revision: evidence.revision.trim() } : {}),
        },
      }),
      fresh_context: 'NOT_REQUIRED',
    },
  };
}

/**
 * The simple path. Deterministic fields core requires are filled with visible values; nothing
 * governance-bearing is invented. The authority document is resolved from local truth, fail-closed.
 */
function normalizeSimple(
  input: Record<string, unknown>,
  env: OperatorRequestEnv,
  err: (code: CharterErrorCode, path: string, message: string) => void,
  errors: CharterError[],
): OperatorRequestResult {
  const task = input.task;
  if (!isNonEmptyString(task)) {
    err('INVALID_TASK_CONTRACT', 'task', 'task must be a non-empty statement of the bounded work');
  }
  const role = input.role;
  if (!isOneOf(role, ROLES)) {
    err('INVALID_TASK_CONTRACT', 'role', `role must be one of ${ROLES.join('|')}`);
  }
  const target = input.target;
  if (!isOneOf(target, EXECUTION_TARGETS)) {
    err('INVALID_TASK_CONTRACT', 'target', `target must be one of ${EXECUTION_TARGETS.join('|')}`);
  }
  const rootValue = input.root;
  if (rootValue !== undefined && !isNonEmptyString(rootValue)) {
    err('INVALID_TASK_CONTRACT', 'root', 'root must be a non-empty absolute path when stated');
  }
  // The session directory is the documented default; a STATED root is never silently replaced by it.
  const root = isNonEmptyString(rootValue) ? rootValue.trim() : env.cwd.trim();
  if (!isAbsolute(root)) {
    err('INVALID_TASK_CONTRACT', 'root', 'root must be an absolute path (or omitted so the session directory is used)');
  }
  const authority = input.authority;
  if (!isNonEmptyString(authority)) {
    err(
      'AUTHORITY_UNRESOLVED',
      'authority',
      'authority must name the authority document this work is bounded by, as a path relative to the root (e.g. PLAN.md); the advanced form is authority_evidence beside task_contract',
    );
  }
  const scope = toEntries(input.scope, 'scope', err);
  const gates = toEntries(input.gates, 'gates', err);
  const freshValue = input.fresh;
  if (freshValue !== undefined && !isOneOf(freshValue, OPERATOR_FRESH_VALUES)) {
    err('INVALID_TASK_CONTRACT', 'fresh', `fresh must be one of ${OPERATOR_FRESH_VALUES.join('|')} when stated`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const roleName = role as Role;
  const targetName = target as ExecutionTargetName;
  const fresh: OperatorFreshValue = (freshValue as OperatorFreshValue | undefined) ?? 'not_required';
  if (fresh === 'required' && targetName === 'parent') {
    // A fresh session is a property of the session that runs the work, and the parent target IS this
    // session: the requirement cannot be met here, and Charter does not reinterpret it.
    return {
      ok: false,
      errors: [
        {
          code: 'UNSUPPORTED_BY_EXECUTION_TARGET',
          path: 'fresh',
          message:
            "execution_target=parent runs the work in this session, so a fresh child session cannot be required; delegate the work (target=subagents) or drop the requirement",
        },
      ],
    };
  }

  const document = resolveLocalAuthority((authority as string).trim(), root);
  if (!document.ok) return { ok: false, errors: [document.error] };

  const slug = slugify(task as string);
  const contract: TaskContract = {
    version: 'charter/v0.1',
    task: { id: slug, class: OPERATOR_DEFAULT_TASK_CLASS, risk: OPERATOR_DEFAULT_RISK },
    role: roleName,
    execution_target: targetName,
    root,
    authority: { sources: [document.reference] },
    scope: scopeEntries(scope),
    permissions: permissionsForRole(roleName),
    acceptance: acceptanceFor(gates),
    verification: { level: OPERATOR_DEFAULT_VERIFICATION_LEVEL },
  };
  return {
    ok: true,
    request: {
      request_kind: 'simple',
      task_contract: contract,
      authority_reference: document.reference,
      authority_binder: document.binder,
      authority_document: { reference: document.reference, path: document.path },
      fresh_context: fresh === 'required' ? 'REQUIRED' : 'NOT_REQUIRED',
    },
  };
}

/**
 * Resolve the operator's authority document from local truth, fail closed.
 *
 * A root-relative regular file is the only thing this surface admits: an absolute path, a path that
 * escapes the root, a directory, a missing file, and an unreadable file each refuse with the reason
 * they refuse. There is exactly one candidate by construction — this is a path resolution, never a
 * lookup that could return many — so no ambiguity can be silently resolved.
 *
 * The boundary is a FILESYSTEM boundary, not a lexical one: containment is checked on real paths, so
 * a symlink (file or directory) whose target lies outside the declared root is refused exactly like a
 * lexical `../` escape. Reading through the link and calling the content "inside the root" would be
 * the boundary mismatch this check exists to prevent; a link that resolves inside the root is
 * admitted, because the content it delivers is inside the root.
 */
function resolveLocalAuthority(
  reference: string,
  root: string,
):
  | { ok: true; reference: string; path: string; binder: AuthorityBinder }
  | { ok: false; error: CharterError } {
  const refuse = (message: string): { ok: false; error: CharterError } => ({
    ok: false,
    error: { code: 'AUTHORITY_UNRESOLVED', path: 'authority', message },
  });
  if (isAbsolute(reference)) {
    return refuse(
      `authority '${reference}' is an absolute path; this surface admits one authority document relative to the declared root '${root}'`,
    );
  }
  const normalized = posix.normalize(reference);
  if (normalized === '..' || normalized.startsWith('../')) {
    return refuse(
      `authority '${reference}' escapes the declared root '${root}'; an authority document is admitted only as a path inside it`,
    );
  }
  // Resolve the root's real identity first: containment is a property of the filesystem, and a root
  // that cannot be resolved grounds nothing.
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return refuse(`no authority document '${reference}' exists under root '${root}'`);
  }
  const path = resolve(root, reference);
  let realPath: string;
  try {
    realPath = realpathSync(path);
  } catch {
    return refuse(`no authority document '${reference}' exists under root '${root}'`);
  }
  const within = relative(realRoot, realPath);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return refuse(
      `authority '${reference}' resolves outside the declared root '${root}'; an authority document is admitted only as a path inside it, and a symlink target outside is refused`,
    );
  }
  let isFile = false;
  try {
    isFile = statSync(realPath).isFile();
  } catch {
    return refuse(`no authority document '${reference}' exists under root '${root}'`);
  }
  if (!isFile) return refuse(`authority '${reference}' is not a regular file under root '${root}'`);
  let content: string;
  try {
    content = readFileSync(realPath, 'utf8');
  } catch {
    return refuse(`authority document '${reference}' could not be read, so no content identity can be bound to it`);
  }
  if (content.trim().length === 0) {
    return refuse(`authority document '${reference}' is empty, so it grounds no authority`);
  }
  // The binding is the DOCUMENT: the reference is the binder identity, `document` is what kind of
  // evidence this is, and the content is the text the provenance digest is taken over.
  return {
    ok: true,
    reference,
    path,
    binder: createEvidenceBinder({
      [reference]: { id: reference, source_kind: 'document', content },
    }) as AuthorityBinder,
  };
}

/** Completion-approval posture per role: only the roles whose purpose is implementation may write. */
function permissionsForRole(role: Role): Permissions {
  return {
    code_write: ROLE_REPOSITORY_WRITES[role],
    research: false,
    external_write: false,
    release: false,
  };
}

/**
 * Acceptance for the simple surface: the operator's declared gates, and nothing else. Declaring a
 * command is a declaration, not evidence: no assertion binding is invented here, so acceptance stays
 * exactly as strong as what the operator stated and core refuses a contract that states nothing.
 */
function acceptanceFor(gates: string[]): Acceptance {
  return gates.length > 0 ? { commands: [...gates] } : {};
}

/**
 * Scope entries become `scope.directories`: a bounded subtree such as `internal/store/**` names where
 * the work may happen. A scope the operator stated is never widened, never repaired, and never
 * replaced by a default; a wildcard scope still fails closed in core unless the contract explicitly
 * admits unrestricted scope.
 */
function scopeEntries(entries: string[]): Scope {
  return entries.length > 0 ? { directories: [...entries] } : {};
}

/** Read a list-or-string field. A string is one entry unless it states several lines. */
function toEntries(
  value: unknown,
  path: string,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (!Array.isArray(value)) {
    err('INVALID_TASK_CONTRACT', path, `${path} must be a list of non-empty strings`);
    return [];
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (!isNonEmptyString(entry)) {
      err('INVALID_TASK_CONTRACT', path, `${path} must be a list of non-empty strings`);
      return [];
    }
    entries.push(entry.trim());
  }
  return entries;
}

/** A stable task identity derived from the task statement: same statement, same contract identity. */
function slugify(task: string): string {
  const slug = task
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'task';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
