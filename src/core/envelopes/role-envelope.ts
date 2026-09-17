/**
 * Deterministic bounded-instruction compiler.
 *
 * The canonical governance truth lives in ExecutionContract + TargetBinding. RoleEnvelope is only
 * the instruction artifact derived from that truth; it deliberately does not clone model, scope,
 * authority, permissions, capability evidence, or enforcement state into a second rich object.
 */

import { ASSERTION_BINDING_TRUTH, type AssertionBinding } from '../acceptance/assertion-binding.ts';
import type { ExecutionContract } from '../contracts/execution-contract.ts';
import {
  ENFORCEMENT_CONSTRAINTS,
  type Acceptance,
  type AcceptanceReview,
  type EnforcementConstraint,
  type Permissions,
  type Role,
  type Scope,
} from '../contracts/task-contract.ts';
import {
  ENFORCEMENT_TRUTHS,
  type EnforcementTruth,
  type EnforcementTruthTable,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import { evidenceIdentity } from '../provenance/evidence.ts';

export interface RoleEnvelope {
  version: 'charter/v0.1';
  task_id: string;
  role: Role;
  execution_target: 'parent' | 'subagents';
  /** Identity of the canonical resolved truth this instruction was derived from. */
  execution_contract_identity: string;
  /** Identity of the one target binding this instruction was derived from. */
  target_binding_identity: string;
  /** What this role must accomplish. */
  objective: string;
  /** What the role must do. */
  operating_rules: string[];
  /** What the role must not do. */
  prohibitions: string[];
  /** Finite stop conditions. */
  stop_conditions: string[];
  /** Deterministic rendered instruction text. */
  rendered_instruction: string;
  /** Identity of this instruction artifact. */
  instruction_identity: string;
}

/** Compile one deterministic instruction artifact from already-resolved target truth.
 *
 * This function is an internal compiler phase. The public facade owns validation/resolution/binding,
 * so there is no second runtime validation boundary here and no process-local provenance registry to
 * defend.
 */
export function compileRoleEnvelope(binding: TargetBinding): RoleEnvelope {
  const contract = binding.execution_contract;
  const template = roleTemplate(contract.role, contract);
  const operatingRules = [...commonOperatingRules(contract), ...template.operating_rules];
  const prohibitions = [...template.prohibitions];
  const stopConditions = [...COMMON_STOP_CONDITIONS, ...template.stop_conditions];
  const renderedInstruction = renderInstruction(
    binding,
    template.objective,
    operatingRules,
    prohibitions,
    stopConditions,
  );

  const base = {
    version: 'charter/v0.1' as const,
    task_id: contract.task_id,
    role: contract.role,
    execution_target: contract.execution_target,
    execution_contract_identity: evidenceIdentity(contract),
    target_binding_identity: evidenceIdentity(binding),
    objective: template.objective,
    operating_rules: operatingRules,
    prohibitions,
    stop_conditions: stopConditions,
    rendered_instruction: renderedInstruction,
  };
  return deepFreeze({ ...base, instruction_identity: evidenceIdentity(base) });
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
  const { permissions } = contract;
  return [
    'before any source read, search, command, or edit: create a bounded dependency-aware TODO list (maximum 8 items) and keep its state updated.',
    'stay inside the declared scope, authority, role boundaries, and permissions; if a step needs more, stop and report it instead of widening them.',
    'report what you did and what verification actually showed; never report an unverified result as verified.',
    'a green result stays green: when the required acceptance and verification are satisfied, report the result and stop; do not append optional improvement work.',
    'do not create or drive run state, retries, escalation rounds, or workflow steps; this envelope describes one bounded piece of work and stops.',
    permissions.release
      ? 'release authority is granted by this contract; it covers only what this contract names, and nothing beyond it.'
      : 'release is not authorized by this contract: do not tag, push a release, publish, or deploy.',
    permissions.external_write
      ? 'external mutation is granted by this contract; it covers only the declared scope.'
      : 'do not mutate anything outside the local repository.',
    permissions.research
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
  'the contract contradicts itself, or a required step contradicts the declared scope, authority, role boundaries, or permissions. Stop and report the contradiction.',
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
  return envelope.rendered_instruction;
}

function renderInstruction(
  binding: TargetBinding,
  objective: string,
  operatingRules: readonly string[],
  prohibitions: readonly string[],
  stopConditions: readonly string[],
): string {
  const contract = binding.execution_contract;
  const model = contract.model;
  const sections: string[][] = [
    [
      'ROLE',
      `role: ${contract.role}`,
      `task: ${contract.task_id}`,
      `model: ${model.tier} / ${model.resolved} (preferred ${model.preferred}, fallback_used=${model.fallback_used})`,
      `execution_target: ${contract.execution_target}`,
      'model_rule: do not reroute, substitute, promote, or inspect the availability of the resolved model; model routing is not yours.',
    ],
    ['CURRENT TASK', `objective: ${objective}`],
    [
      'AUTHORITY',
      `bound_sources: ${list(contract.authority.bound_sources)}`,
      'rule: cite and act on these bound authority sources only; never introduce an authority source.',
    ],
    ['BOUNDARIES', ...boundaryLines(contract)],
    ['SCOPE', ...scopeLines(contract.scope)],
    ['NON-GOALS', ...bullets(contract.non_goals, 'none declared')],
    ['PERMISSIONS', ...permissionLines(contract.permissions)],
    [
      'ENFORCEMENT TRUTH',
      ...capabilityEvidenceLines(binding),
      ...enforcementLines(binding.enforcement),
    ],
    ['OPERATING RULES', 'must:', ...bullets(operatingRules, 'none'), 'must_not:', ...bullets(prohibitions, 'none')],
    ['ACCEPTANCE', ...acceptanceLines(contract.acceptance, contract.assertion_bindings)],
    ['VERIFICATION', `level: ${contract.verification.level}`],
    ['STOP CONDITIONS', ...bullets(stopConditions, 'none')],
  ];
  return sections.map((lines) => lines.join('\n')).join('\n\n') + '\n';
}

function boundaryLines(contract: ExecutionContract): string[] {
  const canImplement = (contract.role === 'implement' || contract.role === 'correct') && contract.permissions.code_write;
  return [
    'scope: bounded',
    'product_semantics: none',
    'architecture: none',
    `implementation: ${canImplement ? 'bounded' : 'none'}`,
    `semantic_adjudication: ${contract.role === 'adjudicate' ? 'bounded' : 'none'}`,
    'search_space: bounded',
    'archaeology: false',
    `research: ${contract.permissions.research}`,
    `mutation.repository: ${contract.permissions.code_write ? 'write' : 'none'}`,
    `mutation.external: ${contract.permissions.external_write ? 'write' : 'none'}`,
    `mutation.release: ${contract.permissions.release ? 'authorized' : 'none'}`,
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
function capabilityEvidenceLines(binding: TargetBinding): string[] {
  const capability = binding.capability_evidence;
  const availability = binding.execution_contract.model_availability;
  const capabilityLine =
    capability.class === 'attested'
      ? `capability_evidence: attested by ${capability.source_kind} '${capability.source}'${sourceVersion(capability)} (identity ${capability.evidence_identity}).`
      : `capability_evidence: unattested claim (identity ${capability.evidence_identity}) — nothing here is attested, so no constraint below is reported ENFORCED.`;
  const availabilityLine =
    availability.class === 'attested'
      ? `model_availability: attested by model_registry '${availability.source}'${sourceVersion(availability)} (identity ${availability.evidence_identity}).`
      : `model_availability: unattested claim (identity ${availability.evidence_identity}) — the resolved model rests on a claimed inventory, not on an attested registry.`;
  const tools = binding.execution_contract.execution_policy?.allowed_tools ?? [];
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


function bullets(items: readonly string[], empty: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${empty}`];
}

function list(items: readonly string[]): string {
  return items.length > 0 ? items.join(', ') : 'none declared';
}

// ── Minimal helper ──────────────────────────────────────────────────────────

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
