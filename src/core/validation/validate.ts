import { isAbsolute, posix } from 'node:path';

import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import {
  ACTION_REQUIRES_PERMISSION,
  ENFORCEMENT_CONSTRAINTS,
  ENFORCEMENT_REQUIREMENTS,
  ROLES,
  RISKS,
  ROLE_REPOSITORY_WRITES,
  STRUCTURED_ACTIONS,
  TASK_CLASSES,
  VERIFICATION_LEVELS,
  type Scope,
  type TaskContract,
  type TaskRequirements,
} from '../contracts/task-contract.ts';

export type ValidationResult =
  | { ok: true; contract: TaskContract }
  | { ok: false; errors: CharterError[] };

// ── Closed object field lists (Finding 1) ───────────────────────────────────
const TASK_CONTRACT_KEYS = [
  'version',
  'task',
  'role',
  'execution_target',
  'root',
  'authority',
  'scope',
  'permissions',
  'acceptance',
  'verification',
  'actions',
  'non_goals',
  'requirements',
  'execution_policy',
] as const;
const TASK_KEYS = ['id', 'class', 'risk', 'evidence'] as const;
const AUTHORITY_KEYS = ['sources'] as const;
const SCOPE_KEYS = ['blockers', 'files', 'symbols', 'directories', 'sections', 'allow_unrestricted'] as const;
const EXECUTION_POLICY_KEYS = ['allowed_tools'] as const;
const PERMISSION_KEYS = ['code_write', 'research', 'external_write', 'release'] as const;
const ACCEPTANCE_KEYS = ['commands', 'assertions', 'review'] as const;
const ACCEPTANCE_REVIEW_KEYS = ['required', 'independence', 'executor'] as const;
const VERIFICATION_KEYS = ['level'] as const;
const REQUIREMENTS_KEYS = ['enforcement'] as const;

function checkUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  err: (code: CharterErrorCode, path: string, message: string) => void,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const path = prefix ? `${prefix}.${key}` : key;
      err('INVALID_TASK_CONTRACT', path, `unknown field '${path}'`);
    }
  }
}

/**
 * Validate a candidate TaskContract, fail-closed (spec §41 Phase 1).
 * Deterministic: the same input and env always produce the same ordered result.
 * Errors are reported in fixed phase order: structure → role/permission → scope → acceptance → actions.
 * Authority references are structurally validated here and bound exactly once during resolution.
 */
export function validateTaskContract(input: unknown): ValidationResult {
  const errors: CharterError[] = [];
  const err = (code: CharterErrorCode, path: string, message: string): void => {
    errors.push({ code, message, path });
  };

  // ── Structure ──────────────────────────────────────────────────────────────
  if (!isRecord(input)) {
    err('INVALID_TASK_CONTRACT', '', 'contract must be an object');
    return { ok: false, errors };
  }
  checkUnknownKeys(input, TASK_CONTRACT_KEYS, '', err);
  if (input.version !== 'charter/v0.1') {
    err('INVALID_TASK_CONTRACT', 'version', `version must be 'charter/v0.1', got ${describe(input.version)}`);
  }

  const task = input.task;
  if (!isRecord(task)) {
    err('INVALID_TASK_CONTRACT', 'task', 'task must be an object');
  } else {
    checkUnknownKeys(task, TASK_KEYS, 'task', err);
    if (!isNonEmptyString(task.id)) {
      err('INVALID_TASK_CONTRACT', 'task.id', 'task.id must be a non-empty string');
    }
    if (!isOneOf(task.class, TASK_CLASSES)) {
      err('INVALID_TASK_CONTRACT', 'task.class', `task.class must be one of ${TASK_CLASSES.join('|')}`);
    }
    if (!isOneOf(task.risk, RISKS)) {
      err('INVALID_TASK_CONTRACT', 'task.risk', `task.risk must be one of ${RISKS.join('|')}`);
    }
    if (task.evidence !== undefined && !isStringList(task.evidence)) {
      err('INVALID_TASK_CONTRACT', 'task.evidence', 'task.evidence must be a list of non-empty strings');
    }
  }

  if (!isOneOf(input.role, ROLES)) {
    err('INVALID_TASK_CONTRACT', 'role', `role must be one of ${ROLES.join('|')}`);
  }
  if (!isOneOf(input.execution_target, ['parent', 'subagents'] as const)) {
    err('INVALID_TASK_CONTRACT', 'execution_target', "execution_target must be 'parent' or 'subagents'");
  }
  if (!isNonEmptyString(input.root) || !isAbsolute(input.root)) {
    err('INVALID_TASK_CONTRACT', 'root', 'root must be an absolute path');
  }

  const authority = input.authority;
  if (!isRecord(authority)) {
    err('INVALID_TASK_CONTRACT', 'authority.sources', 'authority.sources must be a non-empty list of references');
  } else {
    checkUnknownKeys(authority, AUTHORITY_KEYS, 'authority', err);
    if (!isStringList(authority.sources) || authority.sources.length === 0) {
      err('INVALID_TASK_CONTRACT', 'authority.sources', 'authority.sources must be a non-empty list of references');
    }
  }

  const scope = input.scope;
  if (!isRecord(scope)) {
    err('INVALID_TASK_CONTRACT', 'scope', 'scope must be an object');
  } else {
    checkUnknownKeys(scope, SCOPE_KEYS, 'scope', err);
    for (const field of ['blockers', 'files', 'symbols', 'directories', 'sections'] as const) {
      if (scope[field] !== undefined && !isStringList(scope[field])) {
        err('INVALID_TASK_CONTRACT', `scope.${field}`, `scope.${field} must be a list of non-empty strings`);
      }
    }
    if (scope.allow_unrestricted !== undefined && typeof scope.allow_unrestricted !== 'boolean') {
      err('INVALID_TASK_CONTRACT', 'scope.allow_unrestricted', 'scope.allow_unrestricted must be a boolean');
    }
  }

  const permissions = input.permissions;
  if (!isRecord(permissions)) {
    err('INVALID_TASK_CONTRACT', 'permissions', 'permissions must be an object');
  } else {
    checkUnknownKeys(permissions, PERMISSION_KEYS, 'permissions', err);
    for (const key of ['code_write', 'research', 'external_write', 'release'] as const) {
      if (typeof permissions[key] !== 'boolean') {
        err('INVALID_TASK_CONTRACT', `permissions.${key}`, `permissions.${key} must be a boolean`);
      }
    }
  }

  const acceptance = input.acceptance;
  if (!isRecord(acceptance)) {
    err('INVALID_TASK_CONTRACT', 'acceptance', 'acceptance must be an object');
  } else {
    checkUnknownKeys(acceptance, ACCEPTANCE_KEYS, 'acceptance', err);
    for (const field of ['commands', 'assertions'] as const) {
      if (acceptance[field] !== undefined && !isStringList(acceptance[field])) {
        err('INVALID_TASK_CONTRACT', `acceptance.${field}`, `acceptance.${field} must be a list of non-empty strings`);
      }
    }
    const review = acceptance.review;
    if (review !== undefined) {
      if (!isRecord(review)) {
        err('INVALID_TASK_CONTRACT', 'acceptance.review', 'acceptance.review must be an object');
      } else {
        checkUnknownKeys(review, ACCEPTANCE_REVIEW_KEYS, 'acceptance.review', err);
        if (typeof review.required !== 'boolean') {
          err('INVALID_TASK_CONTRACT', 'acceptance.review.required', 'acceptance.review.required must be a boolean');
        }
        if (!isOneOf(review.independence, ['none', 'independent'] as const)) {
          err(
            'INVALID_TASK_CONTRACT',
            'acceptance.review.independence',
            "acceptance.review.independence must be 'none' or 'independent'",
          );
        }
        if (review.executor !== undefined && !isOneOf(review.executor, ['same_session', 'fresh_session'] as const)) {
          err(
            'INVALID_TASK_CONTRACT',
            'acceptance.review.executor',
            "acceptance.review.executor must be 'same_session' or 'fresh_session'",
          );
        }
      }
    }
  }

  const verification = input.verification;
  if (!isRecord(verification)) {
    err('INVALID_TASK_CONTRACT', 'verification.level', `verification.level must be one of ${VERIFICATION_LEVELS.join('|')}`);
  } else {
    checkUnknownKeys(verification, VERIFICATION_KEYS, 'verification', err);
    if (!isOneOf(verification.level, VERIFICATION_LEVELS)) {
      err('INVALID_TASK_CONTRACT', 'verification.level', `verification.level must be one of ${VERIFICATION_LEVELS.join('|')}`);
    }
  }


  if (input.actions !== undefined && !(Array.isArray(input.actions) && input.actions.every((a) => isOneOf(a, STRUCTURED_ACTIONS)))) {
    err('INVALID_TASK_CONTRACT', 'actions', `actions must be a list of ${STRUCTURED_ACTIONS.join('|')}`);
  }

  if (input.non_goals !== undefined && !isStringList(input.non_goals)) {
    err('INVALID_TASK_CONTRACT', 'non_goals', 'non_goals must be a list of non-empty strings');
  }

  // ── Required hard enforcement (spec §24, Phase 3 additive shape) ────────────
  // Closed like every other governance-bearing object: unknown requirement names, unknown
  // constraint names, and any value other than 'required' fail closed. A contract without
  // `requirements` keeps exactly its previous behavior — nothing is defaulted or inferred here.
  if (input.requirements !== undefined) {
    if (!isRecord(input.requirements)) {
      err('INVALID_TASK_CONTRACT', 'requirements', 'requirements must be an object');
    } else {
      checkUnknownKeys(input.requirements, REQUIREMENTS_KEYS, 'requirements', err);
      const enforcement = input.requirements.enforcement;
      if (enforcement !== undefined) {
        if (!isRecord(enforcement)) {
          err('INVALID_TASK_CONTRACT', 'requirements.enforcement', 'requirements.enforcement must be an object');
        } else {
          checkUnknownKeys(enforcement, ENFORCEMENT_CONSTRAINTS, 'requirements.enforcement', err);
          for (const constraint of ENFORCEMENT_CONSTRAINTS) {
            const value = enforcement[constraint];
            if (value !== undefined && !isOneOf(value, ENFORCEMENT_REQUIREMENTS)) {
              err(
                'INVALID_TASK_CONTRACT',
                `requirements.enforcement.${constraint}`,
                `requirements.enforcement.${constraint} must be '${ENFORCEMENT_REQUIREMENTS[0]}'`,
              );
            }
          }
        }
      }
    }
  }

  // ── Canonical execution policy (v0.1.1 T3) ─────────────────────────────────
  // Closed like every other governance-bearing object. The tool policy is singular: it exists here
  // or it does not exist at all, and an empty declaration is refused rather than read either as
  // "no tools allowed" or as "no policy".
  if (input.execution_policy !== undefined) {
    if (!isRecord(input.execution_policy)) {
      err('INVALID_TASK_CONTRACT', 'execution_policy', 'execution_policy must be an object');
    } else {
      checkUnknownKeys(input.execution_policy, EXECUTION_POLICY_KEYS, 'execution_policy', err);
      const allowedTools = input.execution_policy.allowed_tools;
      if (allowedTools !== undefined && (!isStringList(allowedTools) || allowedTools.length === 0)) {
        err(
          'INVALID_TASK_CONTRACT',
          'execution_policy.allowed_tools',
          'execution_policy.allowed_tools must name at least one tool; declare it only when a bounded tool set exists',
        );
      }
    }
  }

  // Structural failures are terminal: semantic checks assume well-shaped fields.
  if (errors.length > 0) return { ok: false, errors };
  // SAFETY: every structural check above passed, so the record is a well-shaped TaskContract; the
  // cast only restores the type the checks just established.
  const c = input as unknown as TaskContract;

  // ── Role / task / permission compatibility (spec §17, §7, §8) ──────────────
  if (c.permissions.code_write && !ROLE_REPOSITORY_WRITES[c.role]) {
    err(
      'INVALID_TASK_CONTRACT',
      'permissions.code_write',
      `role=${c.role} conflicts with code_write=true`,
    );
  }
  if (c.role === 'planner') {
    if (c.permissions.external_write) {
      err(
        'INVALID_TASK_CONTRACT',
        'permissions.external_write',
        'role=planner conflicts with external_write=true',
      );
    }
    if (c.permissions.release) {
      err(
        'INVALID_TASK_CONTRACT',
        'permissions.release',
        'role=planner conflicts with release=true',
      );
    }
  }
  if (c.task.class === 'T4' && (c.task.evidence?.length ?? 0) === 0) {
    err('INVALID_TASK_CONTRACT', 'task.evidence', 'task.class=T4 MUST be evidence-backed');
  }

  // ── Scope (spec §14) ───────────────────────────────────────────────────────
  const writes = c.permissions.code_write && ROLE_REPOSITORY_WRITES[c.role];
  const declaredScope = scopeEntries(c.scope);
  if (writes && declaredScope.length === 0) {
    err(
      'INVALID_TASK_CONTRACT',
      'scope',
      `role=${c.role} with code_write=true requires bounded scope; scope is empty`,
    );
  }
  for (const field of ['files', 'directories'] as const) {
    for (const entry of c.scope[field] ?? []) {
      const normalized = posix.normalize(entry.trim());
      if (isAbsolute(entry.trim()) || normalized === '..' || normalized.startsWith('../')) {
        err('SCOPE_CONTRADICTION', `scope.${field}`, `scope entry '${entry}' escapes or ignores the declared root`);
        continue;
      }
      if (UNRESTRICTED_PATTERNS.has(normalized) && c.scope.allow_unrestricted !== true) {
        err(
          'CONTRACT_REQUIRES_EXPLICIT_OVERRIDE',
          `scope.${field}`,
          `scope entry '${entry}' is unrestricted and requires scope.allow_unrestricted=true`,
        );
      }
    }
  }

  // ── Acceptance (spec §18) ──────────────────────────────────────────────────
  const commands = c.acceptance.commands ?? [];
  const assertions = c.acceptance.assertions ?? [];
  const review = c.acceptance.review;
  if (commands.length === 0 && assertions.length === 0 && review?.required !== true) {
    err(
      'ACCEPTANCE_INVALID',
      'acceptance',
      'acceptance requires at least one of commands, assertions, or review.required=true',
    );
  }
  for (const command of commands) {
    if (isFuzzy(command)) {
      err('ACCEPTANCE_INVALID', 'acceptance.commands', `command '${command}' is not verifiable acceptance`);
    }
  }
  for (const assertion of assertions) {
    if (!ASSERTION_ID.test(assertion) || FUZZY_TOKENS.has(assertion.trim().toLowerCase())) {
      err(
        'ACCEPTANCE_INVALID',
        'acceptance.assertions',
        `assertion '${assertion}' is not a verifiable, machine-checkable claim`,
      );
    }
  }
  if (review?.required === true && review.executor === 'same_session' && review.independence === 'independent') {
    err(
      'CONTRACT_CONTRADICTION',
      'acceptance.review.independence',
      'same-session review must not be represented as independent',
    );
  }

  // ── Forbidden structured actions (spec §22) ────────────────────────────────
  for (const action of c.actions ?? []) {
    const required = ACTION_REQUIRES_PERMISSION[action];
    if (!c.permissions[required]) {
      err(
        'CONTRACT_CONTRADICTION',
        'actions',
        `${required}=false conflicts with requested ${required} action '${action}'`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, contract: normalize(c) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wildcard shapes that mean "everything" (spec §14). Bounded subtrees such as `internal/**` are not listed. */
const UNRESTRICTED_PATTERNS = new Set(['*', '**', '**/*', '**/**', '/', '/*', '.', './', './*']);

/** Assertions must be named, machine-checkable claims, not prose (spec §18). */
const ASSERTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const FUZZY_TOKENS = new Set([
  'production_ready',
  'production-ready',
  'productionready',
  'robust',
  'quality',
  'good',
  'better',
  'correct',
  'complete',
  'stable',
  'clean',
  'nice',
  'ready',
]);

/** Fuzzy acceptance phrases (spec §18). Explicit list; no NLP interpretation. */
const FUZZY_PHRASES = [
  'make production ready',
  'make it production ready',
  'production ready',
  'ensure architecture is good',
  'architecture is good',
  'make it robust',
  'make it better',
  'make it good',
  'improve quality',
  'ensure quality',
  'improve the quality',
  'make it complete',
];

function isFuzzy(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return FUZZY_PHRASES.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

function scopeEntries(scope: Scope): string[] {
  return [...(scope.blockers ?? []), ...(scope.files ?? []), ...(scope.symbols ?? []), ...(scope.directories ?? []), ...(scope.sections ?? [])];
}

function normalize(c: TaskContract): TaskContract {
  const contract: TaskContract = {
    version: 'charter/v0.1',
    task: { id: c.task.id, class: c.task.class, risk: c.task.risk, ...(c.task.evidence ? { evidence: [...c.task.evidence] } : {}) },
    role: c.role,
    execution_target: c.execution_target,
    root: c.root,
    authority: { sources: [...c.authority.sources] },
    scope: {
      ...(c.scope.blockers ? { blockers: [...c.scope.blockers] } : {}),
      ...(c.scope.files ? { files: [...c.scope.files] } : {}),
      ...(c.scope.symbols ? { symbols: [...c.scope.symbols] } : {}),
      ...(c.scope.directories ? { directories: [...c.scope.directories] } : {}),
      ...(c.scope.sections ? { sections: [...c.scope.sections] } : {}),
      ...(c.scope.allow_unrestricted ? { allow_unrestricted: true } : {}),
    },
    permissions: { ...c.permissions },
    acceptance: {
      ...(c.acceptance.commands ? { commands: [...c.acceptance.commands] } : {}),
      ...(c.acceptance.assertions ? { assertions: [...c.acceptance.assertions] } : {}),
      ...(c.acceptance.review ? { review: { ...c.acceptance.review } } : {}),
    },
    verification: { level: c.verification.level },
    ...(c.actions ? { actions: [...c.actions] } : {}),
    ...(c.non_goals ? { non_goals: [...c.non_goals] } : {}),
    ...(c.requirements ? { requirements: normalizeRequirements(c.requirements) } : {}),
    ...(c.execution_policy
      ? {
          execution_policy: {
            ...(c.execution_policy.allowed_tools ? { allowed_tools: [...c.execution_policy.allowed_tools] } : {}),
          },
        }
      : {}),
  };
  return contract;
}

/** Requirements are copied verbatim: validation has already proven them closed and complete. */
function normalizeRequirements(requirements: TaskRequirements): TaskRequirements {
  const enforcement = requirements.enforcement;
  return enforcement ? { enforcement: { ...enforcement } } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function describe(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
