/**
 * Bounded escalation policy (spec §29, §30, §31; §41 Phase 5).
 *
 * One pure question, answered from explicit evidence:
 *
 *   explicit outcome + explicit counters + resolved limits  →  one bounded next action
 *
 * This is a DECISION FUNCTION, not a workflow. It does not retry, escalate, adjudicate, correct,
 * spawn, queue, schedule, persist, increment, resume, or supervise anything: it decides, returns one
 * value, and is done. Every mutation of a counter is the caller's, and every subsequent step is the
 * caller's. There is no run object, no phase graph, no current step, no transition table — just one
 * `switch` over a closed outcome vocabulary and a few explicit comparisons.
 *
 * Authority has exactly one channel (Phase 5 charter §9, §10). Role, immutable limits, and terminal
 * policy come from the resolved Phase 4 artifact carried by the input; the caller supplies only
 * ephemeral evidence — the outcome, the counters, and, where de-escalation genuinely needs one, an
 * explicit downstream role. There is no second copy of role, limits, or terminal policy to override,
 * and unknown input keys fail closed rather than being silently ignored (§21).
 *
 * Determinism and purity (§19, §20): no clock, no randomness, no environment lookup, no filesystem,
 * no module-level mutable state, no input mutation. Deep-frozen inputs are fine, because nothing
 * here is written to.
 *
 * The policy never executes the action it decides. `RETRY_SAME_ROLE` is a decision, not a retry;
 * `ADJUDICATE` is a decision, not an adjudicator invocation.
 */

import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import { ROLES, type Limits, type Role } from '../contracts/task-contract.ts';
import type { TerminalPolicy } from '../contracts/execution-contract.ts';
import type { RoleEnvelope } from '../envelopes/role-envelope.ts';

// ── Admitted execution outcomes (Phase 5 charter §2) ────────────────────────

/**
 * Closed vocabulary of bounded execution outcomes. These are EVIDENCE already produced elsewhere —
 * a finished bounded piece of work reported its result. They are not worker states, not lifecycle
 * states, and not something this module can observe or advance.
 */
export const EXECUTION_OUTCOMES = [
  'SUCCESS',
  'MECHANICAL_FAILURE',
  'SEMANTIC_AMBIGUITY',
  'AUTHORITY_CONTRADICTION',
  'ARCHITECTURE_CONTRADICTION',
  'MODEL_UNAVAILABLE',
  'EXECUTION_TARGET_UNSUPPORTED',
  'ADJUDICATION_RESOLVED',
  'ADJUDICATION_UNRESOLVED',
] as const;
export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];

// ── Next-action vocabulary (Phase 5 charter §3) ─────────────────────────────

/**
 * Closed next-action vocabulary. Every value is a bounded decision about what the caller may do
 * next — never a lifecycle state. Deliberately absent: QUEUED, RUNNING, WAITING, BLOCKED_WORKER,
 * RESUMING, RECOVERING. This module cannot express them, so it cannot return them.
 */
export const NEXT_ACTIONS = [
  'PASS',
  'RETRY_SAME_ROLE',
  'ADJUDICATE',
  'DE_ESCALATE_TO_ROLE',
  'HUMAN_DECISION_REQUIRED',
  'STOP_MODEL_UNAVAILABLE',
  'STOP_UNSUPPORTED_BY_EXECUTION_TARGET',
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

// ── Input: one resolved artifact + explicit ephemeral evidence (§8, §9) ─────

/**
 * Explicit ephemeral counters. All three are required and explicit: absent evidence is never
 * defaulted to zero, because a default here would silently answer a comparison the caller never
 * stated. No timestamps, no run ids, no worker ids, no lifecycle metadata (§8).
 */
export interface EscalationCounters {
  /** Completed clean retries of the same role. Policy constant: at most one is allowed (§4). */
  clean_retries_used: number;
  /** Completed correction rounds, compared against the contract's declared `limits.correction_rounds`. */
  correction_rounds_used: number;
  /** Completed semantic/authority escalations, compared against `limits.semantic_escalations`. */
  semantic_escalations_used: number;
}

/**
 * The only admitted input. `role_envelope` is the resolved Phase 4 artifact and the single channel
 * for role, limits, and terminal policy; `outcome`, `counters`, and the optional `resume_role` are
 * the entire ephemeral evidence this policy is allowed to add.
 */
export interface NextActionInput {
  role_envelope: RoleEnvelope;
  outcome: ExecutionOutcome;
  counters: EscalationCounters;
  /**
   * An explicitly supplied downstream role, read only for `ADJUDICATION_RESOLVED`. Never inferred
   * from history and never chosen by this module (§7).
   */
  resume_role?: Role;
}

/** One bounded decision. Structured fields are authoritative; `reason` is deterministic prose only. */
export interface NextActionDecision {
  action: NextAction;
  /**
   * The role the next bounded action belongs to, present only where that action names one. Absent
   * for terminal states, for PASS, and for HUMAN_DECISION_REQUIRED — none of which routes to a role.
   */
  role?: Role;
  /** Deterministic explanation of the comparison that decided this. Never advice, never a prompt. */
  reason: string;
}

export type NextActionResult =
  | { ok: true; decision: NextActionDecision }
  | { ok: false; errors: CharterError[] };

const INPUT_KEYS = ['role_envelope', 'outcome', 'counters', 'resume_role'] as const;
const COUNTER_KEYS = ['clean_retries_used', 'correction_rounds_used', 'semantic_escalations_used'] as const;
const LIMIT_KEYS = ['correction_rounds', 'semantic_escalations'] as const;
/**
 * The fields this policy reads. Contents are checked fail-closed and are NOT re-resolved: re-running
 * Phase 2/4 is not Phase 5 work, and nothing here reproduces a limit, a role, or a terminal policy.
 */
const ENVELOPE_ROLE = 'role';
const ENVELOPE_LIMITS = 'limits';
const ENVELOPE_TERMINAL = 'terminal_state';
const TERMINAL_PATH = 'role_envelope.terminal_state';

/** The resolved v0.1 terminal policy this mapping operationalizes (spec §20, §35). */
const CANONICAL_TERMINAL: TerminalPolicy = {
  success: 'acceptance_verified',
  ambiguity: 'escalate',
  limit_exceeded: 'human_decision_required',
};

/**
 * The frozen policy constants of the one-clean-retry rule (spec §29, Phase 5 charter §4). A policy
 * constant, not a contract limit: it is the same for every contract and is not caller-controlled.
 */
const CLEAN_RETRIES_ALLOWED = 1;

type Err = (code: CharterErrorCode, path: string, message: string) => void;

// ── The decision function ───────────────────────────────────────────────────

/**
 * Decide exactly one truthful next action (Phase 5 charter §4–§7).
 *
 * Pure, deterministic, and fail-closed. Same resolved artifact, same outcome, same counters ⇒
 * deep-equivalent decision (§19). Nothing is mutated, persisted, or executed (§20, §22).
 */
export function decideNextAction(input: unknown): NextActionResult {
  const errors: CharterError[] = [];
  const err: Err = (code, path, message) => {
    errors.push({ code, message, path });
  };

  if (!isRecord(input)) {
    return fail('', 'next-action input must be an object');
  }
  // Ephemeral evidence is a closed shape: an unknown key — `retry_forever`, `force_continue`,
  // `auto_switch_target`, `next_model`, `worker_id`, `resume_from_state`, anything else — is refused
  // rather than ignored, since an ignored lifecycle-looking key is a claim that appears to work §21.
  checkUnknownKeys(input, INPUT_KEYS, '', err);

  const envelope = checkEnvelope(input.role_envelope, err);
  const outcome = checkOutcome(input.outcome, err);
  const counters = checkCounters(input.counters, err);
  const resumeRole = checkResumeRole(input.resume_role, err);
  if (errors.length > 0 || envelope === undefined || outcome === undefined || counters === undefined) {
    return { ok: false, errors };
  }

  const limits = envelope.limits;
  // An outcome that reports an adjudication can only come from an adjudicating envelope. Accepting
  // the mismatch would open a de-escalation channel from a role that never adjudicated (§7).
  if (outcome === 'ADJUDICATION_RESOLVED' || outcome === 'ADJUDICATION_UNRESOLVED') {
    if (envelope.role !== 'adjudicate') {
      return {
        ok: false,
        errors: [
          {
            code: 'CONTRACT_CONTRADICTION',
            path: 'role_envelope.role',
            message: `outcome=${outcome} reports an adjudication, but role_envelope.role=${envelope.role} did not adjudicate`,
          },
        ],
      };
    }
  }

  // A `correct` retry is one correction round: the canonical correction loop is bounded by
  // `limits.correction_rounds` (spec §30), and one pass of the `correct` role is one round.
  const correctionExhausted = isExhausted(counters.correction_rounds_used, limits.correction_rounds);
  // Declared bounds are the only bounds: an undeclared limit is not a bound this policy invents, so
  // the canonical default response of spec §29 applies instead of a fabricated ceiling.
  const semanticExhausted = isExhausted(counters.semantic_escalations_used, limits.semantic_escalations);

  switch (outcome) {
    case 'SUCCESS':
      return decide('PASS', undefined, 'outcome=SUCCESS satisfied the declared acceptance; the success terminal state is reached and no further work is decided.');

    case 'MECHANICAL_FAILURE':
      if (counters.clean_retries_used >= CLEAN_RETRIES_ALLOWED) {
        return decide(
          'HUMAN_DECISION_REQUIRED',
          undefined,
          `outcome=MECHANICAL_FAILURE with clean_retries_used=${counters.clean_retries_used} exhausts the one-clean-retry policy; no further retry is decided.`,
        );
      }
      if (envelope.role === 'correct' && correctionExhausted) {
        return decide(
          'HUMAN_DECISION_REQUIRED',
          undefined,
          `outcome=MECHANICAL_FAILURE would request another correction round, but correction_rounds_used=${counters.correction_rounds_used} has reached the declared limits.correction_rounds=${limits.correction_rounds}.`,
        );
      }
      return decide(
        'RETRY_SAME_ROLE',
        envelope.role,
        `outcome=MECHANICAL_FAILURE with clean_retries_used=${counters.clean_retries_used} is inside the one-clean-retry policy; role=${envelope.role} may be retried once.`,
      );

    case 'SEMANTIC_AMBIGUITY':
      return routeToAdjudication('SEMANTIC_AMBIGUITY', counters.semantic_escalations_used, limits.semantic_escalations, semanticExhausted);

    case 'AUTHORITY_CONTRADICTION':
      return routeToAdjudication(
        'AUTHORITY_CONTRADICTION',
        counters.semantic_escalations_used,
        limits.semantic_escalations,
        semanticExhausted,
      );

    case 'ARCHITECTURE_CONTRADICTION':
      // Not routed to adjudication: v0.1 grants no architecture-review authority (spec §7.5, §29).
      return decide(
        'HUMAN_DECISION_REQUIRED',
        undefined,
        'outcome=ARCHITECTURE_CONTRADICTION is a human decision; charter holds no architecture authority and does not route it to adjudication.',
      );

    case 'MODEL_UNAVAILABLE':
      // Model fallback was already fully resolved during resolution (spec §10). Nothing is selected,
      // retried, or re-routed here.
      return decide(
        'STOP_MODEL_UNAVAILABLE',
        undefined,
        'outcome=MODEL_UNAVAILABLE reached execution after model fallback was resolved; no model is selected or re-routed here.',
      );

    case 'EXECUTION_TARGET_UNSUPPORTED':
      return decide(
        'STOP_UNSUPPORTED_BY_EXECUTION_TARGET',
        undefined,
        'outcome=EXECUTION_TARGET_UNSUPPORTED records a capability gap the selected target cannot supply; the target is not switched and no enforcement is manufactured.',
      );

    case 'ADJUDICATION_RESOLVED': {
      // De-escalation (spec §31, Phase 5 charter §7): reasoning does not own what follows it. The
      // downstream role must be supplied explicitly; it is never inferred, and the adjudicator is
      // never its own successor.
      if (resumeRole === undefined) {
        return decide(
          'HUMAN_DECISION_REQUIRED',
          undefined,
          'outcome=ADJUDICATION_RESOLVED carries no explicit resume_role, so no truthful downstream role exists to de-escalate to.',
        );
      }
      if (resumeRole === 'adjudicate') {
        return decide(
          'HUMAN_DECISION_REQUIRED',
          undefined,
          'outcome=ADJUDICATION_RESOLVED with resume_role=adjudicate would keep the adjudicator as its own successor; adjudication does not own subsequent implementation.',
        );
      }
      return decide(
        'DE_ESCALATE_TO_ROLE',
        resumeRole,
        `outcome=ADJUDICATION_RESOLVED returns execution to the explicitly supplied downstream role=${resumeRole}, not to the adjudicator.`,
      );
    }

    case 'ADJUDICATION_UNRESOLVED':
      // No bounded decision was reached, so there is no truthful automatic re-route: re-running the
      // same adjudication would be an unbounded escalation loop decided by this policy.
      return decide(
        'HUMAN_DECISION_REQUIRED',
        undefined,
        'outcome=ADJUDICATION_UNRESOLVED reached no bounded decision; no automatic re-adjudication or correction is decided.',
      );
  }
}

/**
 * Ambiguity and authority contradiction share one bounded route (spec §29): the same escalation
 * counter bounds both, and exhausting it is a human decision, never a loop (spec §30).
 */
function routeToAdjudication(
  outcome: ExecutionOutcome,
  used: number,
  limit: number | undefined,
  exhausted: boolean,
): NextActionResult {
  if (exhausted) {
    return decide(
      'HUMAN_DECISION_REQUIRED',
      undefined,
      `outcome=${outcome} with semantic_escalations_used=${used} has reached the declared limits.semantic_escalations=${limit}; no further escalation is decided.`,
    );
  }
  return decide(
    'ADJUDICATE',
    'adjudicate',
    `outcome=${outcome} with semantic_escalations_used=${used} is inside ${describeLimit(limit)}; one bounded adjudication is decided.`,
  );
}

/** A declared bound is exhausted at `used >= limit` (spec §30). An undeclared bound is not a bound. */
function isExhausted(used: number, limit: number | undefined): boolean {
  return typeof limit === 'number' && used >= limit;
}

function describeLimit(limit: number | undefined): string {
  return limit === undefined ? 'the canonical default escalation response, no limit declared' : `the declared limits.semantic_escalations=${limit}`;
}

function decide(action: NextAction, role: Role | undefined, reason: string): NextActionResult {
  return { ok: true, decision: Object.freeze(role === undefined ? { action, reason } : { action, role, reason }) };
}

// ── Fail-closed input validation ────────────────────────────────────────────

interface EnvelopeFacts {
  role: Role;
  limits: Limits;
}

/**
 * Read the three facts this policy needs from the resolved artifact, fail-closed. The envelope stays
 * the caller's value: it is read, never frozen, cloned, or written to.
 */
function checkEnvelope(value: unknown, err: Err): EnvelopeFacts | undefined {
  if (!isRecord(value)) {
    err('INVALID_TASK_CONTRACT', 'role_envelope', 'a resolved Phase 4 role envelope is required');
    return undefined;
  }
  const role = value[ENVELOPE_ROLE];
  if (!isOneOf(role, ROLES)) {
    err('INVALID_TASK_CONTRACT', 'role_envelope.role', `role_envelope.role must be one of ${ROLES.join('|')}`);
  }

  const limits = value[ENVELOPE_LIMITS];
  if (!isRecord(limits)) {
    err('INVALID_TASK_CONTRACT', 'role_envelope.limits', 'a resolved envelope must carry its resolved limits');
    return undefined;
  }
  checkUnknownKeys(limits, LIMIT_KEYS, 'role_envelope.limits', err);
  for (const key of LIMIT_KEYS) {
    const declared = limits[key];
    // A malformed limit is refused, never defaulted: a defaulted ceiling would decide a comparison
    // the contract never declared.
    if (declared !== undefined && !(Number.isInteger(declared) && (declared as number) >= 0)) {
      err(
        'INVALID_TASK_CONTRACT',
        `role_envelope.limits.${key}`,
        `role_envelope.limits.${key} must be a non-negative integer`,
      );
    }
  }

  checkTerminalPolicy(value[ENVELOPE_TERMINAL], err);
  if (role === undefined || !isOneOf(role, ROLES)) return undefined;
  return { role, limits: limits as Limits };
}

/**
 * This mapping operationalizes the resolved terminal policy; it does not reinterpret it (§10). An
 * artifact carrying a different policy is refused rather than answered with policy the artifact does
 * not hold.
 */
function checkTerminalPolicy(value: unknown, err: Err): void {
  if (!isRecord(value)) {
    err('INVALID_TASK_CONTRACT', TERMINAL_PATH, 'a resolved envelope must carry its resolved terminal policy');
    return;
  }
  for (const key of ['success', 'ambiguity', 'limit_exceeded'] as const) {
    if (value[key] !== CANONICAL_TERMINAL[key]) {
      err(
        'INVALID_TASK_CONTRACT',
        `${TERMINAL_PATH}.${key}`,
        `${TERMINAL_PATH}.${key} must be '${CANONICAL_TERMINAL[key]}'; the bounded decision mapping is defined for the resolved terminal policy only`,
      );
    }
  }
}

function checkOutcome(value: unknown, err: Err): ExecutionOutcome | undefined {
  if (value === undefined) {
    err('INVALID_TASK_CONTRACT', 'outcome', 'an explicit execution outcome is required');
    return undefined;
  }
  if (!isOneOf(value, EXECUTION_OUTCOMES)) {
    err('INVALID_TASK_CONTRACT', 'outcome', `outcome must be one of ${EXECUTION_OUTCOMES.join('|')}`);
    return undefined;
  }
  return value;
}

/** Every counter is explicit, integral, and non-negative — the whole truth this policy compares (§8). */
function checkCounters(value: unknown, err: Err): EscalationCounters | undefined {
  if (!isRecord(value)) {
    err('INVALID_TASK_CONTRACT', 'counters', 'counters must be an object stating every counter explicitly');
    return undefined;
  }
  checkUnknownKeys(value, COUNTER_KEYS, 'counters', err);
  let complete = true;
  for (const key of COUNTER_KEYS) {
    const counter = value[key];
    if (counter === undefined) {
      err('INVALID_TASK_CONTRACT', `counters.${key}`, `counters.${key} must be stated explicitly`);
      complete = false;
    } else if (!(Number.isInteger(counter) && (counter as number) >= 0)) {
      err('INVALID_TASK_CONTRACT', `counters.${key}`, `counters.${key} must be a non-negative integer`);
      complete = false;
    }
  }
  return complete ? (value as unknown as EscalationCounters) : undefined;
}

/** A downstream role is admitted only as an explicit canonical role (§7). Nothing is inferred. */
function checkResumeRole(value: unknown, err: Err): Role | undefined {
  if (value === undefined) return undefined;
  if (!isOneOf(value, ROLES)) {
    err('INVALID_TASK_CONTRACT', 'resume_role', `resume_role must be one of ${ROLES.join('|')}`);
    return undefined;
  }
  return value;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], prefix: string, err: Err): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const path = prefix ? `${prefix}.${key}` : key;
      err('INVALID_TASK_CONTRACT', path, `unknown field '${path}'`);
    }
  }
}

function fail(path: string, message: string): NextActionResult {
  return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path, message }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}
