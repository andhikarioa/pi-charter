/**
 * Deterministic role-envelope compiler (spec §7, §16, §23, §32–§34, §37; §41 Phase 4).
 *
 * A `RoleEnvelope` is an INSTRUCTION ARTIFACT. It says what a role may do and when it must stop. It
 * executes nothing: no session, no worker, no retry, no escalation round, no workflow step, no run
 * state, no receipt. It is a value a caller can render into a prompt.
 *
 * The compiler consumes the Phase 3 binding — the resolved contract plus enforcement truth — and
 * accepts no second channel for role, model, scope, authority, permissions, requirements, target, or
 * enforcement truth (spec §16). Every governance-bearing value is COPIED from the binding, never
 * supplied by the caller and never widened. The only values the compiler authors are instruction
 * text: the role templates below, and the renderings of already-resolved truth.
 *
 * Enforcement truth is transported, never recomputed and never upgraded (spec §23, E10). A
 * constraint the target only receives as instruction is rendered as instruction; `ENFORCED` wording
 * appears only where Phase 3 reported `ENFORCED`.
 *
 * Role semantics are target-independent: the same role compiles to the same objective, operating
 * rules, prohibitions, and stop conditions on `parent` and on `subagents`. Only target facts differ
 * — execution target identity, resolved model, and enforcement truth — and §19 of the Phase 4
 * charter forbids a second semantic template per target.
 */

import { ASSERTION_BINDING_TRUTH, type AssertionBinding } from '../acceptance/assertion-binding.ts';
import {
  checkEnvironmentEvidence,
  type EnvironmentEvidence,
} from '../attestation/attestation.ts';
import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import type { ExecutionContract, TerminalPolicy } from '../contracts/execution-contract.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  EXECUTION_TARGETS,
  ROLES,
  type Acceptance,
  type AcceptanceReview,
  type EnforcementConstraint,
  type ExecutionPolicy,
  type ExecutionTargetName,
  type Limits,
  type Permissions,
  type Role,
  type Scope,
  type VerificationLevel,
} from '../contracts/task-contract.ts';
import { isResolvedCorrectionTarget, type ResolvedCorrectionTarget } from '../correction/correction-authority.ts';
import {
  ENFORCEMENT_TRUTHS,
  type EnforcementTruth,
  type EnforcementTruthTable,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import type { Jurisdiction } from '../jurisdiction/jurisdiction.ts';
import { isEvidenceProvenance, type EvidenceProvenance } from '../provenance/evidence.ts';
import type { ModelSelection } from '../routing/model-routing.ts';

// ── Role envelope (Phase 4 charter §2) ──────────────────────────────────────

/**
 * Bounded role instruction contract. Every governance-bearing field is a copy of resolved truth
 * (Phase 2 contract, Phase 3 binding); every authored field is instruction text.
 *
 * Deliberately absent: any handle to a session, worker, process, run, retry, or workflow step. This
 * type cannot express lifecycle, which is why Phase 5 escalation loops cannot share it.
 */
export interface RoleEnvelope {
  version: 'charter/v0.1';
  role: Role;
  task_id: string;
  model: ModelSelection;
  execution_target: ExecutionTargetName;

  objective: string;

  authority: {
    /** The references the envelope may cite: the already-bound set, never the binder's catalogue. */
    bound_sources: string[];
    /** Resolved provenance per reference (T1): the evidence identity the contract actually bound. */
    provenance: EvidenceProvenance[];
  };
  scope: Scope;
  /** The single canonical tool policy of the resolved contract, when one exists (T3). */
  execution_policy?: ExecutionPolicy;
  jurisdiction: Jurisdiction;
  permissions: Permissions;

  /** Phase 3 truth, carried verbatim. Never recomputed, never upgraded. */
  enforcement_truth: EnforcementTruthTable;
  /** What the enforcement truth rests on: attested environment truth, or an unattested claim (T2). */
  capability_evidence: EnvironmentEvidence;
  /** How the resolved model's availability was evidenced (H2). */
  model_availability: EnvironmentEvidence;

  acceptance: Acceptance;
  /**
   * Verifier-bound acceptance evidence (T4). The envelope claims `ASSERTION_BOUND` for each of
   * these and never `ASSERTION_VERIFIED`.
   */
  assertion_bindings: AssertionBinding[];
  /** The admitted correction targets, and only those (T6). Empty for every role but `correct`. */
  correction_targets: ResolvedCorrectionTarget[];
  verification: { level: VerificationLevel };
  limits: Limits;
  non_goals: string[];
  terminal_state: TerminalPolicy;

  /** What the role must do. */
  operating_rules: string[];
  /** What the role must never do — the role boundary, stated explicitly (Phase 4 charter §4–§8). */
  prohibitions: string[];
  /** Finite terminal conditions. The envelope describes them; it implements no state machine (§15). */
  stop_conditions: string[];
}

// ── Compiler input ──────────────────────────────────────────────────────────

/**
 * The only admitted compiler input.
 *
 * Exactly one provenance path exists for every governance-bearing value:
 * TaskContract → ExecutionContract → TargetBinding → RoleEnvelope. A caller cannot supply role,
 * model, scope, authority, permissions, jurisdiction, requirements, target, or enforcement truth
 * here, and an attempt to do so fails closed rather than being ignored (Phase 4 charter §3, §18).
 */
export interface RoleEnvelopeInput {
  target_binding: TargetBinding;
}

export type RoleEnvelopeResult =
  | { ok: true; envelope: RoleEnvelope }
  | { ok: false; errors: CharterError[] };

const ENVELOPE_INPUT_KEYS = ['target_binding'] as const;
const BINDING_KEYS = ['target', 'enforcement', 'capability_evidence', 'execution_contract'] as const;
/**
 * Governance-bearing fields the envelope copies out of the binding. Presence and object-ness are
 * checked so a malformed artifact cannot be rendered as `undefined` truth; contents are copied
 * verbatim and are NOT re-validated — re-implementing Phase 1/2 validation is not Phase 4 work.
 */
const CARRIED_KEYS = [
  'model',
  'jurisdiction',
  'authority',
  'scope',
  'permissions',
  'acceptance',
  'verification',
  'limits',
  'terminal_state',
] as const;

type Err = (code: CharterErrorCode, path: string, message: string) => void;

/**
 * Compile one truthful role envelope from a Phase 3 binding (Phase 4 charter §1).
 *
 * Fail-closed and deterministic: same binding always produces a deep-equivalent envelope. Nothing
 * here executes, schedules, retries, escalates, or persists anything.
 */
export function compileRoleEnvelope(input: unknown): RoleEnvelopeResult {
  const errors: CharterError[] = [];
  const err: Err = (code, path, message) => {
    errors.push({ code, message, path });
  };

  if (!isRecord(input)) {
    return fail('', 'role envelope input must be an object');
  }
  // Any governance-bearing key a caller adds here has no admitted meaning, so it is refused rather
  // than silently dropped: an ignored `permissions` or `scope` would be an override channel that
  // merely happens to be inert today (Phase 4 charter §3, §18).
  checkUnknownKeys(input, ENVELOPE_INPUT_KEYS, '', err);
  const binding: unknown = input.target_binding;
  if (!isRecord(binding)) {
    err('INVALID_TASK_CONTRACT', 'target_binding', 'a Phase 3 target binding is required');
    return { ok: false, errors };
  }
  checkUnknownKeys(binding, BINDING_KEYS, 'target_binding', err);
  if (!isOneOf(binding.target, EXECUTION_TARGETS)) {
    err('INVALID_TASK_CONTRACT', 'target_binding.target', 'target_binding.target must be a canonical execution target');
  }

  const contract: unknown = binding.execution_contract;
  if (!isRecord(contract)) {
    err('INVALID_TASK_CONTRACT', 'target_binding.execution_contract', 'target_binding must carry a resolved ExecutionContract');
    return { ok: false, errors };
  }
  if (!isOneOf(contract.role, ROLES)) {
    err('INVALID_TASK_CONTRACT', 'target_binding.execution_contract.role', 'a canonical role is required');
  }
  if (!isOneOf(contract.execution_target, EXECUTION_TARGETS)) {
    err(
      'INVALID_TASK_CONTRACT',
      'target_binding.execution_contract.execution_target',
      'a canonical execution_target is required',
    );
  } else if (binding.target !== contract.execution_target) {
    // No target substitution and no retargeting: envelope truth must describe the target the
    // contract selected, or nothing (§26, §27, Phase 3 identity rule).
    err(
      'CONTRACT_CONTRADICTION',
      'target_binding.execution_contract.execution_target',
      `binding targets execution_target=${String(binding.target)} but its contract selects execution_target=${contract.execution_target}`,
    );
  }
  const enforcement = checkEnforcementTable(binding.enforcement, err);
  const capabilityEvidence = checkEnvironmentEvidence(
    binding.capability_evidence,
    'target_binding.capability_evidence',
    err,
  );
  for (const key of CARRIED_KEYS) {
    if (!isRecord(contract[key])) {
      err(
        'INVALID_TASK_CONTRACT',
        `target_binding.execution_contract.${key}`,
        `a resolved contract must carry ${key}; the envelope compiles no substitute`,
      );
    }
  }
  if (
    !isRecord(contract.verification) ||
    typeof contract.verification.level !== 'string'
  ) {
    err(
      'INVALID_TASK_CONTRACT',
      'target_binding.execution_contract.verification.level',
      'a resolved contract must carry verification.level; the envelope compiles no substitute',
    );
  }
  if (!isStringList(contract.non_goals)) {
    err(
      'INVALID_TASK_CONTRACT',
      'target_binding.execution_contract.non_goals',
      'a resolved contract must carry non_goals; the envelope compiles no substitute',
    );
  }
  if (typeof contract.task_id !== 'string' || contract.task_id.length === 0) {
    err('INVALID_TASK_CONTRACT', 'target_binding.execution_contract.task_id', 'a resolved contract must carry a task_id');
  }
  checkAuthorityProvenance(contract.authority, err);
  const modelAvailability = checkEnvironmentEvidence(
    contract.model_availability,
    'target_binding.execution_contract.model_availability',
    err,
  );
  const assertionBindings = checkAssertionBindings(contract.assertion_bindings, err);
  const correctionTargets = checkCorrectionTargets(contract.correction_targets, err);
  if (contract.execution_policy !== undefined && !isRecord(contract.execution_policy)) {
    err(
      'INVALID_TASK_CONTRACT',
      'target_binding.execution_contract.execution_policy',
      'a resolved contract must carry execution_policy as an object when it declares one',
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  // SAFETY: the shape checks above establish every field the envelope copies. Re-validating a
  // resolved contract is Phase 1/2 work that this phase deliberately does not repeat.
  const src = contract as unknown as ExecutionContract;
  // Fail closed on correction authority in both directions (T6): a `correct` envelope must name at
  // least one admitted target, and no other role carries one. A blocker identifier is a target, and
  // an admitted target is the only thing that authorizes `correct`; a bound authority source never
  // is one.
  if (src.role === 'correct' && correctionTargets.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'target_binding.execution_contract.correction_targets',
          message:
            "role 'correct' requires at least one admitted correction target carrying finding provenance and explicit acceptance provenance; a blocker identifier alone authorizes nothing",
        },
      ],
    };
  }
  if (src.role !== 'correct' && correctionTargets.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'target_binding.execution_contract.correction_targets',
          message: `role '${src.role}' holds no correction authority, so it carries no admitted correction target`,
        },
      ],
    };
  }
  const template = roleTemplate(src.role, src);

  const envelope: RoleEnvelope = {
    version: 'charter/v0.1',
    role: src.role,
    task_id: src.task_id,
    model: structuredClone(src.model),
    execution_target: src.execution_target,
    objective: template.objective,
    // Authority is the already-bound set: never the binder's wider catalogue, never a neighbour. Both
    // the symbolic references and the resolved evidence identity are carried (T1).
    authority: {
      bound_sources: [...src.authority.bound_sources],
      provenance: structuredClone(src.authority.provenance),
    },
    scope: structuredClone(src.scope),
    ...(src.execution_policy ? { execution_policy: structuredClone(src.execution_policy) } : {}),
    jurisdiction: structuredClone(src.jurisdiction),
    permissions: structuredClone(src.permissions),
    // Phase 3 truth, copied. The compiler cannot produce a truth value of its own.
    enforcement_truth: structuredClone(enforcement as EnforcementTruthTable),
    capability_evidence: structuredClone(capabilityEvidence as EnvironmentEvidence),
    model_availability: structuredClone(modelAvailability as EnvironmentEvidence),
    acceptance: structuredClone(src.acceptance),
    assertion_bindings: structuredClone(assertionBindings),
    correction_targets: structuredClone(correctionTargets),
    verification: { level: src.verification.level },
    limits: structuredClone(src.limits),
    non_goals: [...src.non_goals],
    terminal_state: structuredClone(src.terminal_state),
    operating_rules: [...commonOperatingRules(src), ...template.operating_rules],
    prohibitions: [...template.prohibitions],
    stop_conditions: [...COMMON_STOP_CONDITIONS, ...template.stop_conditions],
  };
  // Frozen so the artifact cannot be edited into a wider one after compilation.
  return { ok: true, envelope: deepFreeze(envelope) };
}

/**
 * Compile from a binding the caller already holds, without a wrapper. Available so adapters can
 * hand off envelope truth without ever authoring role text themselves (Phase 4 charter §20).
 */
export function compileBoundRoleEnvelope(binding: TargetBinding): RoleEnvelopeResult {
  return compileRoleEnvelope({ target_binding: binding } satisfies RoleEnvelopeInput);
}

// ── Role templates (spec §7, Phase 4 charter §4–§8) ─────────────────────────

interface RoleTemplate {
  objective: string;
  operating_rules: string[];
  prohibitions: string[];
  stop_conditions: string[];
}

/**
 * Bounded instruction text per role. Prose only: every claim about authority, scope, permission,
 * enforcement, or the model in a rendered envelope comes from resolved truth, never from here.
 */
function roleTemplate(role: Role, contract: ExecutionContract): RoleTemplate {
  switch (role) {
    case 'planner':
      return {
        objective:
          'Decompose already-admitted, sufficiently frozen work into a small number of independently verifiable bounded work units.',
        operating_rules: [
          'decompose only the work the bound authority sources admit; the product semantics of that work are frozen — describe them, do not decide them.',
          'each produced work unit must carry exactly one trusted truth, plus scope, non-goals, acceptance, verification, DONE, and STOP.',
          'derived acceptance must come from the admitted work; do not strengthen it and do not add criteria it does not carry.',
          'order the work units and state their dependencies; a bounded sequence of cards, not a general DAG or workflow runtime.',
          'produce bounded child TaskContract candidates only; you neither admit them, resolve them, nor execute them.',
        ],
        prohibitions: [
          'invent product capability, roadmap, release thesis, or requirements the admitted work does not carry.',
          'reopen or redesign product architecture.',
          'broaden the admitted scope or authority; aggregate child scope and authority must be equal to or narrower than the admitted scope and authority.',
          'authorize release or live mutation.',
          'write, modify, or delete repository content; planning is read-only.',
          'implement code.',
        ],
        stop_conditions: [
          'decomposition is complete: every work unit is bounded, independently verifiable, and carries one trusted truth. Report the cards and stop; do not start decomposing the next phase.',
        ],
      };
    case 'implement':
      return {
        objective:
          'Implement one bounded task whose product semantics and architecture are already sufficiently frozen.',
        operating_rules: [
          'implement the current bounded task only; this envelope carries no next task.',
          'make the minimum sufficient patch, in the fewest files, that satisfies the declared acceptance.',
          'run the required verification and report what it actually showed.',
        ],
        prohibitions: [
          'reopen product semantics, architecture, or the specification; work outside this bounded task is not yours to decide or change.',
          'reinterpret the task or its acceptance criteria.',
          'refactor adjacent code, fix unrelated technical debt, or perform opportunistic cleanup.',
          'implement future phases or work this task does not name.',
          'expand the declared scope or authority.',
        ],
        stop_conditions: [
          'the bounded task is implemented and the required verification has run. Report the patch and the verification result, then stop; do not start the next task.',
        ],
      };
    case 'review':
      return {
        objective: 'Determine whether the bounded implementation satisfies its admitted contract.',
        operating_rules: [
          'review read-only against the named contract, its acceptance criteria, and the bound authority sources.',
          'return PASS, or material findings bounded to what the contract requires. A clean PASS is a valid, expected result.',
          'each finding must name the contract requirement it violates and the evidence that shows the violation.',
        ],
        prohibitions: [
          'modify repository content, or implement a fix, even when the fix is obvious.',
          'invent requirements the contract does not carry, or report style preferences, taste, or unrelated improvements as findings.',
          'perform a general architecture audit, or search for defects outside the review jurisdiction.',
          'broaden the review jurisdiction beyond the declared scope and authority.',
          ...reviewIndependenceProhibitions(contract.acceptance?.review),
        ],
        stop_conditions: [
          'a verdict is reached and reported — PASS, or material evidence-backed findings bounded to the reviewed contract. Report it and stop; do not fix anything.',
        ],
      };
    case 'correct':
      return {
        objective: 'Apply only frozen, accepted findings from a prior review or adjudication result.',
        operating_rules: [
          ...correctionTargetRules(contract),
          'make the minimum sufficient patch, and preserve accepted behavior the findings do not mention.',
          'after correcting, re-run the required verification and report what it actually showed.',
        ],
        prohibitions: [
          "reopen or contest the reviewer's jurisdiction, or perform a second audit.",
          'invent new findings, or fix anything the accepted findings do not name.',
          'redesign architecture or change product semantics.',
          'fix unrelated technical debt or expand the declared scope.',
        ],
        stop_conditions: [
          'every accepted finding is closed and any regression those corrections induced is closed. Report the corrections, then stop; do not hunt for further findings.',
          'a correction appears to require work outside the accepted findings. Stop and report it instead of doing it.',
        ],
      };
    case 'adjudicate':
      return {
        objective:
          'Resolve one bounded semantic, authority, or contract contradiction that materially blocks truthful execution.',
        operating_rules: [
          'name the single contradiction being adjudicated, and resolve only that contradiction.',
          'decide from the bound authority sources, and cite them.',
          'emit exactly one bounded outcome: FROZEN_DECISION, HUMAN_DECISION_REQUIRED, or UNRESOLVED.',
          'a FROZEN_DECISION may constrain later execution; it does not execute it.',
        ],
        prohibitions: [
          'implement code, edit the repository, or otherwise execute the decision.',
          'own architecture review, or hold architecture authority.',
          'invent roadmap, product capability, or new product semantics.',
          'perform a broad semantic audit beyond the named contradiction.',
          'expand the declared scope or authority.',
        ],
        stop_conditions: [
          'one bounded decision has been emitted — FROZEN_DECISION, HUMAN_DECISION_REQUIRED, or UNRESOLVED. Report it and stop; do not implement it.',
        ],
      };
    default:
      // Unreachable: the caller proved `role` canonical before calling. No role is invented here.
      return { objective: '', operating_rules: [], prohibitions: [], stop_conditions: [] };
  }
}

/**
 * Review independence honesty (spec §26.1, Phase 4 charter §6). The envelope never claims
 * independence this contract does not carry — and when it does carry independence, the binding
 * already proved the target can provide it (Phase 3 refuses the binding otherwise).
 */
function reviewIndependenceProhibitions(review: AcceptanceReview | undefined): string[] {
  if (review?.required === true && review.independence === 'independent') return [];
  return [
    'describe this review as independent, or present it as a substitute for independent review; this contract does not carry independent review.',
  ];
}

/**
 * Name the admitted correction targets and the evidence that admits each one (T6). `scope.blockers`
 * is WHAT must be corrected; the target is admitted only because a finding resolves AND an explicit
 * acceptance resolves. No findings registry is consulted or invented: both links are already
 * resolved truth, and compilation fails closed before this text is authored when none is admitted.
 */
function correctionTargetRules(contract: ExecutionContract): string[] {
  const targets = contract.correction_targets;
  const sources = contract.authority.bound_sources;
  const admitted = targets
    .map(
      (target) =>
        `${target.id} ← finding ${target.finding.binding_id} [${digestLabel(target.finding)}] accepted by ${target.acceptance.binding_id} [${digestLabel(target.acceptance)}]`,
    )
    .join('; ');
  return [
    `the accepted findings are frozen; the admitted correction targets are: ${list(targets.map((target) => target.id))}. Correct exactly those findings and nothing else.`,
    `each target is admitted by two resolved evidence links: ${admitted}. A blocker identifier alone admits nothing, and a bound authority source (${list(sources)}) grounds those targets without ever being itself a target.`,
  ];
}

/** Short, stable digest label for instruction text. The full digest is in the resolved artifact. */
function digestLabel(provenance: { content_digest: string }): string {
  return provenance.content_digest.slice(0, 12);
}

// ── Common instruction text ─────────────────────────────────────────────────

/**
 * Instruction-level constraints every role inherits. Each permission/jurisdiction line is derived
 * from resolved truth, so this authored text can only restate authority — never grant it.
 */
function commonOperatingRules(contract: ExecutionContract): string[] {
  const { permissions, jurisdiction } = contract;
  return [
    'before any source read, search, command, or edit: create a bounded dependency-aware TODO list (maximum 8 items) and keep its state updated.',
    'stay inside the declared scope, authority, jurisdiction, and permissions; if a step needs more, stop and report it instead of widening them.',
    'report what you did and what verification actually showed; never report an unverified result as verified.',
    'a green result stays green: when the required acceptance and verification are satisfied, report the result and stop; do not append optional improvement work.',
    'do not create or drive run state, retries, escalation rounds, or workflow steps; this envelope describes one bounded piece of work and stops.',
    permissions.release
      ? 'release authority is granted by this contract; it covers only what this contract names, and nothing beyond it.'
      : 'release is not authorized by this contract: do not tag, push a release, publish, or deploy.',
    permissions.external_write
      ? 'external mutation is granted by this contract; it covers only the declared scope.'
      : 'do not mutate anything outside the local repository.',
    jurisdiction.research
      ? 'research is permitted inside the declared scope and authority only; do not widen either.'
      : 'research is off for this contract: do not perform external research, web search, or third-party lookups.',
  ];
}

/** Finite terminal conditions shared by every role (Phase 4 charter §15). */

const COMMON_STOP_CONDITIONS = [
  'required acceptance is satisfied and required verification is satisfied. Report the result and stop; a green result stays green.',
  'an authority question cannot be answered from the bound authority sources. Stop and report the ambiguity; do not resolve it by inference.',
  'the declared scope is insufficient to complete the task. Stop and report the missing scope.',
  'the task needs a guarantee this execution target does not provide: a constraint reported above as INSTRUCTED or UNSUPPORTED is instruction or unavailable, not enforced. Stop and report the limitation.',
  'the contract contradicts itself, or a required step contradicts the declared scope, authority, jurisdiction, or permissions. Stop and report the contradiction.',
  'you are about to do something this envelope prohibits. Stop.',
];

// ── Enforcement truth rendering (spec §9, §23, E10) ─────────────────────────

/**
 * Wording per constraint and truth. `ENFORCED` is the only wording that says hard-enforced; the
 * instruction wording says instruction-level and never claims enforcement; the unavailable wording
 * says the target cannot enforce it and that no instruction replaces enforcement.
 *
 * Nothing here derives truth: the truth is read from the binding and only the wording is chosen.
 */
export const ENFORCEMENT_WORDING: Record<EnforcementConstraint, Record<EnforcementTruth, string>> = {
  model_selection: {
    ENFORCED: 'model selection is hard-enforced by this execution target.',
    INSTRUCTED: 'model selection is instruction-level on this execution target; do not attempt to change the selected model.',
    UNSUPPORTED: 'model selection is not available on this execution target; no instruction can provide it.',
    NOT_APPLICABLE: 'model selection has no applicable policy in this contract.',
  },
  allowed_tools: {
    ENFORCED:
      'the tool ceiling is hard-enforced by this execution target against the declared tool policy; tools outside it are refused.',
    INSTRUCTED: 'the tool ceiling is instruction-level on this execution target. Do not use tools outside the declared tool policy.',
    UNSUPPORTED: 'the tool ceiling cannot be enforced on this execution target, and no instruction replaces enforcement. Stop if the task needs a hard tool ceiling.',
    NOT_APPLICABLE:
      'this contract declares no tool policy, so there is no tool ceiling to enforce or to respect. This is NOT "all tools are allowed": no policy was declared at all.',
  },
  allowed_files: {
    ENFORCED: 'file scope is hard-enforced by this execution target against the exact file policy; access outside it is refused.',
    INSTRUCTED: 'file scope is instruction-level on this execution target. Do not access files outside the declared file policy.',
    UNSUPPORTED: 'file scope cannot be enforced on this execution target, and no instruction replaces enforcement. Stop if the task needs hard file scope.',
    NOT_APPLICABLE:
      'this contract declares no exact file policy, so there is no file scope to enforce. scope.sections and scope.symbols are not file enforcement policy.',
  },
  archaeology_off: {
    ENFORCED: 'the archaeology prohibition is hard-enforced by this execution target.',
    INSTRUCTED: 'the archaeology prohibition is instruction-level on this execution target. Do not perform broad archaeology or repository-wide exploration.',
    UNSUPPORTED: 'the archaeology prohibition cannot be enforced on this execution target, and no instruction replaces enforcement.',
    NOT_APPLICABLE: 'the archaeology prohibition has no applicable policy in this contract.',
  },
  release_forbidden: {
    ENFORCED: 'the release prohibition is hard-enforced by this execution target.',
    INSTRUCTED: 'the release prohibition is instruction-level on this execution target. Do not tag, publish, deploy, or otherwise release.',
    UNSUPPORTED: 'the release prohibition cannot be enforced on this execution target, and no instruction replaces enforcement.',
    NOT_APPLICABLE: 'the release prohibition has no applicable policy in this contract.',
  },
};

// ── Rendering (spec §32) ────────────────────────────────────────────────────

/**
 * Render the envelope as deterministic instruction text, in the canonical section order (spec §32).
 *
 * Pure templating: same envelope always renders to the same bytes. No clock, no randomness, no
 * environment discovery, no LLM prose, no historical context.
 */
export function renderRoleEnvelope(envelope: RoleEnvelope): string {
  const model = envelope.model;
  const sections: string[][] = [
    [
      'ROLE',
      `role: ${envelope.role}`,
      `task: ${envelope.task_id}`,
      `model: ${model.tier} / ${model.resolved} (preferred ${model.preferred}, fallback_used=${model.fallback_used})`,
      `execution_target: ${envelope.execution_target}`,
      'model_rule: do not reroute, substitute, promote, or inspect the availability of the resolved model; model routing is not yours.',
    ],
    ['CURRENT TASK', `objective: ${envelope.objective}`],
    [
      'AUTHORITY',
      `bound_sources: ${list(envelope.authority.bound_sources)}`,
      'rule: cite and act on these bound authority sources only; never introduce an authority source.',
    ],
    ['JURISDICTION', ...jurisdictionLines(envelope.jurisdiction)],
    ['SCOPE', ...scopeLines(envelope.scope)],
    ['NON-GOALS', ...bullets(envelope.non_goals, 'none declared')],
    ['PERMISSIONS', ...permissionLines(envelope.permissions)],
    ['ENFORCEMENT TRUTH', ...capabilityEvidenceLines(envelope), ...enforcementLines(envelope.enforcement_truth)],
    ['OPERATING RULES', 'must:', ...bullets(envelope.operating_rules, 'none'), 'must_not:', ...bullets(envelope.prohibitions, 'none')],
    ['ACCEPTANCE', ...acceptanceLines(envelope.acceptance, envelope.assertion_bindings)],
    ['VERIFICATION', `level: ${envelope.verification.level}`],
    ['ESCALATION', ...escalationLines(envelope.limits)],
    ['TERMINAL STATE', ...terminalLines(envelope.terminal_state)],
    ['STOP CONDITIONS', ...bullets(envelope.stop_conditions, 'none')],
  ];
  return sections.map((lines) => lines.join('\n')).join('\n\n') + '\n';
}

function jurisdictionLines(jurisdiction: Jurisdiction): string[] {
  return [
    `scope: ${jurisdiction.scope}`,
    `product_semantics: ${jurisdiction.product_semantics}`,
    `architecture: ${jurisdiction.architecture}`,
    `implementation: ${jurisdiction.implementation}`,
    `semantic_adjudication: ${jurisdiction.semantic_adjudication}`,
    `search_space: ${jurisdiction.search_space}`,
    `archaeology: ${jurisdiction.archaeology}`,
    `research: ${jurisdiction.research}`,
    `mutation.repository: ${jurisdiction.mutation.repository}`,
    `mutation.external: ${jurisdiction.mutation.external}`,
    `mutation.release: ${jurisdiction.mutation.release}`,
  ];
}

function scopeLines(scope: Scope): string[] {
  const lines: string[] = [];
  for (const dimension of ['files', 'directories', 'symbols', 'sections', 'blockers'] as const) {
    lines.push(`${dimension}: ${list(scope[dimension] ?? [])}`);
  }
  lines.push(`allow_unrestricted: ${scope.allow_unrestricted === true}`);
  return lines;
}

function permissionLines(permissions: Permissions): string[] {
  return [
    `code_write: ${permissions.code_write}`,
    `research: ${permissions.research}`,
    `external_write: ${permissions.external_write}`,
    `release: ${permissions.release}`,
  ];
}

/**
 * What the enforcement truth rests on (T2, T3, H2): the evidence class behind the capability, the
 * evidence class behind model availability, and the canonical policy that would be enforced. A
 * reader can therefore tell "the target cannot enforce this" from "the contract declared nothing"
 * from "nothing here was attested", which the truth table alone cannot express.
 */
function capabilityEvidenceLines(envelope: RoleEnvelope): string[] {
  const capability = envelope.capability_evidence;
  const availability = envelope.model_availability;
  const capabilityLine =
    capability.class === 'attested'
      ? `capability_evidence: attested by ${capability.source_kind} '${capability.source}'${sourceVersion(capability)} (identity ${capability.evidence_identity}).`
      : `capability_evidence: unattested claim (identity ${capability.evidence_identity}) — nothing here is attested, so no constraint below is reported ENFORCED.`;
  const availabilityLine =
    availability.class === 'attested'
      ? `model_availability: attested by model_registry '${availability.source}'${sourceVersion(availability)} (identity ${availability.evidence_identity}).`
      : `model_availability: unattested claim (identity ${availability.evidence_identity}) — the resolved model rests on a claimed inventory, not on an attested registry.`;
  const tools = envelope.execution_policy?.allowed_tools ?? [];
  const policyLine = tools.length
    ? `policy.allowed_tools: ${tools.join(', ')}`
    : 'policy.allowed_tools: none declared — no tool ceiling exists to enforce, which is not a policy of "all tools allowed".';
  return [capabilityLine, availabilityLine, policyLine];
}

function sourceVersion(evidence: { source_version?: string }): string {
  return evidence.source_version ? ` version ${evidence.source_version}` : '';
}

/**
 * One line per constraint, always all five, always the truth the binding reported. The truth is
 * printed verbatim next to instructions that cannot overstate it — a reader can see exactly which of
 * these the target actually refuses on its own.
 */
function enforcementLines(truth: EnforcementTruthTable): string[] {
  return ENFORCEMENT_CONSTRAINTS.map((constraint) => {
    const value: EnforcementTruth | undefined = truth[constraint];
    // A complete table is guaranteed by the compiler; an unreported value is never upgraded to a
    // softer claim, it is reported as unreported.
    const wording = value ? ENFORCEMENT_WORDING[constraint][value] : 'enforcement truth was not reported';
    return `${constraint}: ${value ?? 'UNREPORTED'} — ${wording}`;
  });
}

function acceptanceLines(acceptance: Acceptance, assertionBindings: readonly AssertionBinding[]): string[] {
  const review = acceptance.review;
  return [
    'commands:',
    ...bullets(acceptance.commands ?? [], 'none declared'),
    'assertions:',
    ...bullets(acceptance.assertions ?? [], 'none declared'),
    'assertion_bindings:',
    ...bullets(assertionBindings.map(assertionBindingLine), 'none declared'),
    `review: required=${review?.required === true}, independence=${review?.independence ?? 'none'}, executor=${review?.executor ?? 'none'}`,
    `review_independence: ${reviewIndependenceTruth(review)}`,
  ];
}

/**
 * What a resolved assertion actually proves (T4): a binding to a verifier identity, nothing more.
 * The line never says the verifier ran — execution evidence belongs to the substrate.
 */
function assertionBindingLine(binding: AssertionBinding): string {
  const kind = binding.source_kind ? ` (${binding.source_kind})` : '';
  return `${binding.reference} → verifier ${binding.verifier}${kind} — ${ASSERTION_BINDING_TRUTH}, not ASSERTION_VERIFIED: no execution evidence exists inside Charter, and a satisfied assertion may only be reported after the verifier actually ran and passed.`;
}

/**
 * Review independence truth from contract data only (Phase 4 charter §6). `independent` is claimed
 * only where the contract requires it — and a compiled envelope exists at all only because Phase 3
 * proved this target can supply it.
 */
function reviewIndependenceTruth(review: AcceptanceReview | undefined): string {
  if (review?.required !== true) return 'no review is required by this contract';
  if (review.independence === 'independent') return 'independent review is required by this contract';
  if (review.executor === 'fresh_session') return 'a fresh session is required, but independence is not claimed';
  return 'review is same-session; this is NOT independent review';
}

function escalationLines(limits: Limits): string[] {
  return [
    `limits.correction_rounds: ${limits.correction_rounds ?? 'not declared'}`,
    `limits.semantic_escalations: ${limits.semantic_escalations ?? 'not declared'}`,
  ];
}

function terminalLines(terminal: TerminalPolicy): string[] {
  return [`success: ${terminal.success}`, `ambiguity: ${terminal.ambiguity}`, `limit_exceeded: ${terminal.limit_exceeded}`];
}

function bullets(items: readonly string[], empty: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${empty}`];
}

function list(items: readonly string[]): string {
  return items.length > 0 ? items.join(', ') : 'none declared';
}

// ── Validation helpers ──────────────────────────────────────────────────────

/**
 * The enforcement table is transport, not derivation: it is accepted only when it is complete and
 * every value is a canonical truth. A malformed table is refused rather than rendered as truth.
 */
function checkEnforcementTable(value: unknown, err: Err): EnforcementTruthTable | undefined {
  if (!isRecord(value)) {
    err('INVALID_TASK_CONTRACT', 'target_binding.enforcement', 'enforcement truth must be an object');
    return undefined;
  }
  checkUnknownKeys(value, ENFORCEMENT_CONSTRAINTS, 'target_binding.enforcement', err);
  let complete = true;
  for (const constraint of ENFORCEMENT_CONSTRAINTS) {
    const truth = value[constraint];
    if (truth === undefined) {
      err(
        'INVALID_TASK_CONTRACT',
        `target_binding.enforcement.${constraint}`,
        `enforcement truth for '${constraint}' is missing; every constraint must be reported`,
      );
      complete = false;
    } else if (!isOneOf(truth, ENFORCEMENT_TRUTHS)) {
      err(
        'INVALID_TASK_CONTRACT',
        `target_binding.enforcement.${constraint}`,
        `enforcement truth must be one of ${ENFORCEMENT_TRUTHS.join('|')}`,
      );
      complete = false;
    }
  }
  return complete ? (value as EnforcementTruthTable) : undefined;
}

/**
 * Verifier bindings are transport, not derivation (T4): every entry must already be a complete
 * binding. A malformed entry is refused rather than rendered as a bound assertion.
 */
function checkAssertionBindings(value: unknown, err: Err): AssertionBinding[] {
  const path = 'target_binding.execution_contract.assertion_bindings';
  if (!Array.isArray(value)) {
    err('INVALID_TASK_CONTRACT', path, 'a resolved contract must carry assertion_bindings as a list');
    return [];
  }
  const bindings: AssertionBinding[] = [];
  for (const entry of value) {
    const binding = entry as Record<string, unknown>;
    const complete =
      isRecord(entry) &&
      typeof binding.reference === 'string' &&
      binding.reference.length > 0 &&
      typeof binding.verifier === 'string' &&
      binding.verifier.length > 0 &&
      typeof binding.verifier_digest === 'string' &&
      binding.verifier_digest.length > 0 &&
      (binding.source_kind === undefined || typeof binding.source_kind === 'string');
    if (!complete) {
      err(
        'INVALID_TASK_CONTRACT',
        path,
        'every assertion binding must carry a reference, a verifier identity, and that binding digest',
      );
      continue;
    }
    // SAFETY: the completeness check above establishes every field of the entry; the cast only
    // restores the type of the record this loop just proved complete.
    bindings.push(entry as unknown as AssertionBinding);
  }
  return bindings;
}

/**
 * Admitted correction targets are transport too (T6): an entry that does not carry both evidence
 * links is refused, because a partially-evidenced target would render as admitted authority.
 */
function checkCorrectionTargets(value: unknown, err: Err): ResolvedCorrectionTarget[] {
  const path = 'target_binding.execution_contract.correction_targets';
  if (!Array.isArray(value)) {
    err('INVALID_TASK_CONTRACT', path, 'a resolved contract must carry correction_targets as a list');
    return [];
  }
  const targets: ResolvedCorrectionTarget[] = [];
  for (const entry of value) {
    if (!isResolvedCorrectionTarget(entry)) {
      err(
        'INVALID_TASK_CONTRACT',
        path,
        'every correction target must carry its id, finding provenance, and explicit acceptance provenance',
      );
      continue;
    }
    targets.push(entry);
  }
  return targets;
}

/**
 * Resolved authority provenance is transport, not derivation (T1): a contract that carries a
 * malformed provenance entry is refused, because an instruction artifact must not cite authority
 * whose evidence identity cannot be read.
 */
function checkAuthorityProvenance(value: unknown, err: Err): void {
  const path = 'target_binding.execution_contract.authority.provenance';
  const authority = isRecord(value) ? value : undefined;
  if (!authority || !Array.isArray(authority.provenance) || !authority.provenance.every(isEvidenceProvenance)) {
    err('INVALID_TASK_CONTRACT', path, 'a resolved contract must carry resolved authority provenance');
  }
}

function checkUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], prefix: string, err: Err): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      const path = prefix ? `${prefix}.${key}` : key;
      err('INVALID_TASK_CONTRACT', path, `unknown field '${path}'`);
    }
  }
}

function fail(path: string, message: string): RoleEnvelopeResult {
  return { ok: false, errors: [{ code: 'INVALID_TASK_CONTRACT', path, message }] };
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
