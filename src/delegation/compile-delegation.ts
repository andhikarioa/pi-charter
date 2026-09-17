/**
 * `compileDelegation` — the delegation compile (v0.1.2 Wave 1 — CN1).
 *
 * The dogfood finding this module answers is a conflation, and the conflation is the whole design:
 *
 *   A.  Can Charter compile bounded authority for this target?      ← this module answers YES
 *   B.  Can Charter attest the target runtime?                      ← this module never claims it
 *
 * v0.1.1 answered `execution_target=subagents` with the active session's own integration, which
 * observes the PARENT runtime and therefore refused the contract. Weaker truth was not available, so
 * a perfectly compilable delegation could not be compiled at all, and the operator was pushed toward
 * hand-assembling internals or toward a fake observation. Both are worse than saying less.
 *
 * This path compiles the authority and stops there. It produces a bounded `SubagentsHandoff` and
 * states, in the artifact itself, what it did NOT establish:
 *
 *   Authority        BOUND                (the canonical Phase 2/3 compilation, unchanged)
 *   Handoff          HANDOFF_READY        (bounded delegation parameters, ready for a dispatcher)
 *   Runtime attested NO                   (this process observed no child runtime)
 *   Execution proof  UNAVAILABLE          (no admission handle exists to verify, so none is minted)
 *
 * What it deliberately does NOT do, in this order of importance:
 *
 *   It owns no child execution lifecycle. Delegated work runs in a child this process cannot see, so
 *   this path stops at bounded handoff truth and never turns parent activity into a child-execution
 *   claim.
 *
 *   It claims no child capability. The capability channel it supplies is a candidate carrying an
 *   EMPTY observation set: nothing was observed about the subagents target, so nothing is attested and
 *   no constraint can be reported `ENFORCED`. `ENFORCED` requires trusted capability evidence plus an
 *   applicable canonical policy, and no observation exists here to ground the first half.
 *
 *   It claims no child model. Model availability is supplied through the CLAIM channel
 *   (`available`), so resolution records the environment's own availability as the claim it is. The
 *   handoff's `routing.truth` is `REQUIREMENT_ONLY` — the tier is what the substrate must resolve,
 *   never proof of which model the child ran (CN2).
 *
 *   It invents no authority and no acceptance: the caller supplies the contract and the binder, and
 *   anything the canonical pipeline refuses is refused here with the same errors.
 *
 * Everything after the handoff is the dispatcher's work, outside Charter: dispatch, coordination,
 * retries, child lifecycle, result return. Charter holds no run state for any of it.
 */

import type { AssertionBinder } from '../core/acceptance/assertion-binding.ts';
import type { AuthorityBinder } from '../core/authority/binder.ts';
import { compileForTarget, type CompiledGovernance } from '../core/compile/compile-for-target.ts';
import type { CharterError, CharterErrorCode } from '../core/contracts/errors.ts';
import type { TaskContract } from '../core/contracts/task-contract.ts';
import type { CorrectionAuthorityBinder } from '../core/correction/correction-authority.ts';
import type { ModelProfile } from '../core/routing/model-routing.ts';
import type { SubagentsHandoff } from '../adapters/subagents/subagents-adapter.ts';

/**
 * The delegation's fresh-context requirement, as the delegating operator declared it.
 *
 * This is a REQUIREMENT, and the two legal values are the whole vocabulary: the substrate is required
 * to run the delegated work in a fresh session, or it is not. There is no third state, because this
 * release has no channel that observes whether a child session actually was fresh — an unattested
 * requirement dressed as a capability would be exactly the fabrication this module exists to avoid.
 */
export const DELEGATION_FRESH_CONTEXT = ['REQUIRED', 'NOT_REQUIRED'] as const;
export type DelegationFreshContext = (typeof DELEGATION_FRESH_CONTEXT)[number];

/** The delegation adapter identity the empty capability observation is attributed to (nothing). */
export const DELEGATION_CAPABILITY_SOURCE = 'pi-charter-delegation';

/** The only status this path produces: bounded delegation parameters exist and are ready to hand off. */
export const DELEGATION_HANDOFF_STATUS = 'HANDOFF_READY' as const;

/** Execution proof this path can produce: none, and the vocabulary says so rather than being silent. */
export const DELEGATION_EXECUTION_PROOF = 'UNAVAILABLE' as const;

export interface DelegationCompileInput {
  /** The Phase 1 contract to compile. Validated inside resolution; never pre-resolved by the caller. */
  task_contract: TaskContract;
  /** The authority binder resolution runs under. Required: authority never binds by default. */
  authority_binder: AuthorityBinder;
  /** Required when the contract declares assertions (T4). */
  assertion_binder?: AssertionBinder;
  /** Required when the role is `correct` (T6). */
  correction_binder?: CorrectionAuthorityBinder;
  /** The admitted model profile resolution runs under. Model availability is a CLAIM here (see header). */
  model_profile: ModelProfile;
  /**
   * The runtime environment's own availability claim. This is the CLAIM channel deliberately: this
   * process knows the models its own environment admits, and it observed nothing about the child.
   */
  available: readonly string[];
  /**
   * The operator's dispatch requirement for the delegated run. Defaults to `NOT_REQUIRED`. This is one
   * SOURCE of the handoff's single dispatch freshness truth: the contract's out-of-session review
   * requirement is the other, and the handoff states their union.
   */
  fresh_context?: DelegationFreshContext;
}

/** The bounded handoff, plus the delegation-level facts the resolved contract does not carry. */
export interface DelegationHandoff extends SubagentsHandoff {
  /**
   * The declared root the delegated work is bounded to. Phase 1 validated it as an absolute path, and
   * resolution does not carry it (no Phase 2/3 rule reads it), so the delegation compile states it
   * here from the contract it compiled rather than from a caller-supplied parameter.
   */
  root: string;
  /**
   * What the substrate is REQUIRED to provide. Never an observation about the child runtime.
   *
   * This is the same single dispatch truth as `fresh_session_required`, in the delegation vocabulary:
   * both fields are derived, in one place, from the operator's stated requirement OR the contract's
   * out-of-session review requirement. They can never disagree, so a dispatcher reading either field
   * dispatches a fresh child exactly when one is required.
   */
  fresh_context: DelegationFreshContext;
}

/** What this compilation truthfully established, and what it did not. */
export interface DelegationTruth {
  /** The canonical Phase 2/3 compilation succeeded for this target. */
  authority: 'BOUND';
  /** Bounded delegation parameters exist and are ready to hand to a dispatcher. */
  handoff: typeof DELEGATION_HANDOFF_STATUS;
  /** This process observed no child runtime: the deployment claim is not available here. */
  runtime_attested: false;
  /** No trusted execution evidence for the child can be issued by this path, now or later. */
  execution_proof: typeof DELEGATION_EXECUTION_PROOF;
}

export type DelegationCompileSuccess = {
  ok: true;
  status: typeof DELEGATION_HANDOFF_STATUS;
  handoff: DelegationHandoff;
  /** The compiled artifacts, unmodified — the same values the canonical facade produced. */
  compiled: CompiledGovernance;
  truth: DelegationTruth;
};

export type DelegationCompileResult = DelegationCompileSuccess | { ok: false; errors: CharterError[] };

const INPUT_KEYS = [
  'task_contract',
  'authority_binder',
  'assertion_binder',
  'correction_binder',
  'model_profile',
  'available',
  'fresh_context',
] as const;

/**
 * Compile bounded delegation authority for a `subagents` contract, and stop before anything that
 * would require observing the child.
 *
 * Fail-closed like every other path: an unusable input, a contract this release does not compile for
 * delegation, or any refusal inside the canonical pipeline returns the canonical errors — this module
 * restates no rule and repairs nothing.
 */
export function compileDelegation(input: unknown): DelegationCompileResult {
  const errors: CharterError[] = [];
  const err = (code: CharterErrorCode, path: string, message: string): void => {
    errors.push({ code, message, path });
  };
  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path: '', message: 'delegation compile input must be an object' }] };
  }
  for (const key of Object.keys(input)) {
    if (!(INPUT_KEYS as readonly string[]).includes(key)) err('INVALID_TASK_CONTRACT', key, `unknown field '${key}'`);
  }
  for (const key of ['task_contract', 'authority_binder', 'model_profile', 'available'] as const) {
    if (input[key] === undefined) err('INVALID_TASK_CONTRACT', key, `${key} is required to compile delegation`);
  }
  const freshContext = input.fresh_context;
  if (
    freshContext !== undefined &&
    !(typeof freshContext === 'string' && (DELEGATION_FRESH_CONTEXT as readonly string[]).includes(freshContext))
  ) {
    err('INVALID_TASK_CONTRACT', 'fresh_context', `fresh_context must be one of ${DELEGATION_FRESH_CONTEXT.join('|')}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  const freshRequirement: DelegationFreshContext =
    typeof freshContext === 'string' ? (freshContext as DelegationFreshContext) : 'NOT_REQUIRED';

  // The one target this path compiles. A contract selecting another target is refused rather than
  // re-targeted: the parent target is compiled by the active session; this path owns only bounded
  // child-handoff truth and no child execution lifecycle.
  const declaredTarget = isRecord(input.task_contract) ? input.task_contract.execution_target : undefined;
  if (declaredTarget !== 'subagents') {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'task_contract.execution_target',
          message: `delegation compiles bounded authority for execution_target=subagents only; got ${String(declaredTarget)}`,
        },
      ],
    };
  }

  const compiled = compileForTarget({
    task_contract: input.task_contract as TaskContract,
    authority_binder: input.authority_binder as AuthorityBinder,
    ...(input.assertion_binder !== undefined ? { assertion_binder: input.assertion_binder as AssertionBinder } : {}),
    ...(input.correction_binder !== undefined
      ? { correction_binder: input.correction_binder as CorrectionAuthorityBinder }
      : {}),
    model_profile: input.model_profile as ModelProfile,
    // CLAIM channel: what this environment admits, recorded as a claim, never as attested inventory.
    available: input.available as readonly string[],
    // CAPABILITY channel: a candidate carrying an EMPTY observation set — nothing was observed about
    // the child target, so no axis is recorded true and no constraint can reach ENFORCED (T2, F3).
    capability_attestation: {
      source_kind: 'execution_adapter',
      source: DELEGATION_CAPABILITY_SOURCE,
      payload: { target: 'subagents', capabilities: {} },
    },
  });
  if (!compiled.ok) return { ok: false, errors: compiled.errors };

  const handoff = compiled.compiled.target_handoff;
  if (handoff.target !== 'subagents') {
    // Unreachable through this path (the target was checked above and the adapter refuses otherwise),
    // and reported truthfully instead of being coerced.
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'task_contract.execution_target',
          message: 'the canonical compile produced a handoff for a target other than subagents',
        },
      ],
    };
  }

  // ONE dispatch freshness truth. The operator's stated requirement and the contract's out-of-session
  // review requirement are two sources for the same question at a dispatch boundary — must the child
  // run in a fresh session? — so they are unioned here, once, and both handoff fields mirror the
  // result. Emitting `fresh_context=REQUIRED` beside `fresh_session_required=false` (or the reverse)
  // would let a consumer dispatching on the natural boolean run a non-fresh child against an explicit
  // requirement, which is the contradiction this computation exists to make impossible.
  const dispatchFreshRequired = handoff.fresh_session_required || freshRequirement === 'REQUIRED';

  return {
    ok: true,
    status: DELEGATION_HANDOFF_STATUS,
    handoff: {
      ...handoff,
      root: (input.task_contract as TaskContract).root,
      fresh_session_required: dispatchFreshRequired,
      fresh_context: dispatchFreshRequired ? 'REQUIRED' : 'NOT_REQUIRED',
    },
    compiled: compiled.compiled,
    truth: {
      authority: 'BOUND',
      handoff: DELEGATION_HANDOFF_STATUS,
      runtime_attested: false,
      execution_proof: DELEGATION_EXECUTION_PROOF,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
