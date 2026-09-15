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

import type { CharterError, CharterErrorCode } from '../contracts/errors.ts';
import type { ExecutionContract, TerminalPolicy } from '../contracts/execution-contract.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  EXECUTION_TARGETS,
  ROLES,
  type Acceptance,
  type AcceptanceReview,
  type EnforcementConstraint,
  type ExecutionTargetName,
  type Limits,
  type Permissions,
  type Role,
  type Scope,
  type VerificationLevel,
} from '../contracts/task-contract.ts';
import {
  ENFORCEMENT_TRUTHS,
  type EnforcementTruth,
  type EnforcementTruthTable,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import type { Jurisdiction } from '../jurisdiction/jurisdiction.ts';
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

  authority: { bound_sources: string[] };
  scope: Scope;
  jurisdiction: Jurisdiction;
  permissions: Permissions;

  /** Phase 3 truth, carried verbatim. Never recomputed, never upgraded. */
  enforcement_truth: EnforcementTruthTable;

  acceptance: Acceptance;
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
const BINDING_KEYS = ['target', 'enforcement', 'execution_contract'] as const;
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
  if (errors.length > 0) return { ok: false, errors };

  // SAFETY: the shape checks above establish every field the envelope copies. Re-validating a
  // resolved contract is Phase 1/2 work that this phase deliberately does not repeat.
  const src = contract as unknown as ExecutionContract;
  // Fail closed: a `correct` envelope must name what it corrects. `scope.blockers` is the named
  // accepted correction target set; the bound authority sources only ground those targets and are
  // never themselves targets. Without at least one named target the envelope would claim frozen
  // accepted findings that are not structurally present — a false authority claim. The TaskContract
  // itself stays Phase 1-valid; it is the `correct` envelope that is refused (charter §7).
  if (src.role === 'correct' && namedCorrectionTargets(src).length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'target_binding.execution_contract.scope.blockers',
          message:
            "role 'correct' requires at least one named accepted correction target in scope.blockers; a bound authority source is not itself a correction target",
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
    // Authority is the already-bound set: never the binder's wider catalogue, never a neighbour.
    authority: { bound_sources: [...src.authority.bound_sources] },
    scope: structuredClone(src.scope),
    jurisdiction: structuredClone(src.jurisdiction),
    permissions: structuredClone(src.permissions),
    // Phase 3 truth, copied. The compiler cannot produce a truth value of its own.
    enforcement_truth: structuredClone(enforcement as EnforcementTruthTable),
    acceptance: structuredClone(src.acceptance),
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
 * Name the accepted correction targets, and their grounding authority, as two separate sets (Phase 4
 * charter §7). `scope.blockers` is WHAT must be corrected — the accepted, frozen findings. The bound
 * authority sources are only WHY those targets are authoritative; a source name is not a finding. No
 * findings registry is consulted or invented: both sets are already resolved truth, and compilation
 * fails closed before this text is authored when no correction target is named.
 */
function correctionTargetRules(contract: ExecutionContract): string[] {
  const targets = namedCorrectionTargets(contract);
  const sources = contract.authority.bound_sources;
  return [
    `the accepted findings are frozen; the accepted correction targets named by this contract are: ${list(targets)}. Correct exactly those findings and nothing else.`,
    `those correction targets are grounded by the bound authority sources (${list(sources)}): the sources say why the targets are authoritative, and a bound authority source is not itself a correction target.`,
  ];
}

/**
 * The named accepted correction targets a contract actually carries. Only a populated list of
 * strings counts as a named target: an absent, empty, or malformed value names nothing, and a
 * `correct` envelope must fail closed rather than describe targets it does not have.
 */
function namedCorrectionTargets(contract: ExecutionContract): string[] {
  const blockers: unknown = contract.scope.blockers;
  return Array.isArray(blockers) ? blockers.filter((blocker): blocker is string => typeof blocker === 'string') : [];
}

// ── Common instruction text ─────────────────────────────────────────────────

/**
 * Instruction-level constraints every role inherits. Each permission/jurisdiction line is derived
 * from resolved truth, so this authored text can only restate authority — never grant it.
 */
function commonOperatingRules(contract: ExecutionContract): string[] {
  const { permissions, jurisdiction } = contract;
  const rules = [
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
  return rules;
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
  },
  allowed_tools: {
    ENFORCED: 'the tool ceiling is hard-enforced by this execution target; tools outside the declared ceiling are refused.',
    INSTRUCTED: 'the tool ceiling is instruction-level on this execution target. Do not use tools outside the declared ceiling.',
    UNSUPPORTED: 'the tool ceiling cannot be enforced on this execution target, and no instruction replaces enforcement. Stop if the task needs a hard tool ceiling.',
  },
  allowed_files: {
    ENFORCED: 'file scope is hard-enforced by this execution target; access outside the declared scope is refused.',
    INSTRUCTED: 'file scope is instruction-level on this execution target. Do not access files outside the declared scope.',
    UNSUPPORTED: 'file scope cannot be enforced on this execution target, and no instruction replaces enforcement. Stop if the task needs hard file scope.',
  },
  archaeology_off: {
    ENFORCED: 'the archaeology prohibition is hard-enforced by this execution target.',
    INSTRUCTED: 'the archaeology prohibition is instruction-level on this execution target. Do not perform broad archaeology or repository-wide exploration.',
    UNSUPPORTED: 'the archaeology prohibition cannot be enforced on this execution target, and no instruction replaces enforcement.',
  },
  release_forbidden: {
    ENFORCED: 'the release prohibition is hard-enforced by this execution target.',
    INSTRUCTED: 'the release prohibition is instruction-level on this execution target. Do not tag, publish, deploy, or otherwise release.',
    UNSUPPORTED: 'the release prohibition cannot be enforced on this execution target, and no instruction replaces enforcement.',
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
    ['ENFORCEMENT TRUTH', ...enforcementLines(envelope.enforcement_truth)],
    ['OPERATING RULES', 'must:', ...bullets(envelope.operating_rules, 'none'), 'must_not:', ...bullets(envelope.prohibitions, 'none')],
    ['ACCEPTANCE', ...acceptanceLines(envelope.acceptance)],
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

function acceptanceLines(acceptance: Acceptance): string[] {
  const review = acceptance.review;
  return [
    'commands:',
    ...bullets(acceptance.commands ?? [], 'none declared'),
    'assertions:',
    ...bullets(acceptance.assertions ?? [], 'none declared'),
    `review: required=${review?.required === true}, independence=${review?.independence ?? 'none'}, executor=${review?.executor ?? 'none'}`,
    `review_independence: ${reviewIndependenceTruth(review)}`,
  ];
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
