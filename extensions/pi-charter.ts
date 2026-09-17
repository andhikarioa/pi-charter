/**
 * Pi-native Charter integration.
 *
 * Pi loads this module and receives exactly one tool: `charter_compile`. The tool observes the active
 * provider/model/session from Pi itself, compiles bounded governance for `parent`, or emits a bounded
 * `HANDOFF_READY` delegation for `subagents`. It accepts no caller-authored capability truth.
 *
 * Charter stops after compilation/handoff. It owns no execution handle, post-run verifier, scheduler,
 * child lifecycle, retry loop, or persistence.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MODEL_TIERS,
  normalizeOperatorRequest,
  compileDelegation,
  renderDelegationCompile,
  renderParentCompile,
  renderRefusal,
  type NormalizedOperatorRequest,
} from '../dist/index.js';
// The host seam: this extension is the runtime integration the package ships and Pi loads, so it — and
// not any ordinary consumer of the package — holds the adapter authority capability. The module it
// comes from is deliberately not re-exported by `dist/index.js`.
import {
  createHostAuthorizedAdapterIntegration,
  HOST_ADAPTER_AUTHORITY,
} from '../dist/integration/adapter-integration.js';

/** A plain JSON-schema-shaped parameter definition, as Pi's tool registration expects. */
type ToolParameters = Readonly<Record<string, unknown>>;

/** Minimal structural view of the Pi extension API this integration uses. */
interface PiExtensionApi {
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: ToolParameters;
    /**
     * Pi's pre-validation seam: it runs before the tool arguments are validated against `parameters`.
     * Used here for exactly one thing — the released v0.1.1 advanced spelling of the authority
     * evidence object — so the public schema stays strict while an invocation that worked against the
     * sealed release keeps working.
     */
    prepareArguments?(args: unknown): unknown;
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal: unknown,
      onUpdate: unknown,
      ctx: PiExtensionContext,
    ): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, unknown> }>;
  }): void;
}


/** The live facts this extension can observe about the session it runs in. */
interface PiExtensionContext {
  model?: { provider?: unknown; id?: unknown };
  sessionManager?: { getSessionId?: () => unknown };
  /** The session working directory: the root default and where an authority document is resolved. */
  cwd?: unknown;
}

interface ObservedSession {
  ok: true;
  observation: {
    target: 'parent';
    provider: string;
    model: string;
    session_identity: string;
    runtime: string;
  };
}

interface ObservationRefusal {
  ok: false;
  reason: string;
}

const TOOL_NAME = 'charter_compile' as const;

/** The adapter identity every attestation this integration causes will carry. */
const ADAPTER_NAME = 'pi-charter';

/**
 * The adapter version, read from the package this extension ships in. Absent metadata refuses every
 * operation rather than attributing evidence to a component that cannot name itself.
 */
function readAdapterVersion(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' && parsed.version.trim().length > 0 ? parsed.version.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Observe the live Pi session. Fail-closed: a context that does not report the active model and the
 * session identity is not one this extension can issue evidence about, and it says so instead of
 * filling the gap with a default or with an environment string.
 */
function observeSession(ctx: PiExtensionContext | undefined): ObservedSession | ObservationRefusal {
  const provider = ctx?.model?.provider;
  const model = ctx?.model?.id;
  const session = typeof ctx?.sessionManager?.getSessionId === 'function' ? ctx.sessionManager.getSessionId() : undefined;
  if (typeof provider !== 'string' || provider.trim().length === 0) {
    return { ok: false, reason: 'the active Pi session does not report a model provider, so no environment evidence can be issued' };
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    return { ok: false, reason: 'the active Pi session does not report an active model, so no environment evidence can be issued' };
  }
  if (typeof session !== 'string' || session.trim().length === 0) {
    return { ok: false, reason: 'the active Pi session does not report a session identity, so no environment evidence can be issued' };
  }
  return {
    ok: true,
    observation: {
      target: 'parent',
      provider: provider.trim(),
      model: model.trim(),
      session_identity: session.trim(),
      runtime: process.version,
    },
  };
}

/** The session working directory, when the context reports one. */
function sessionCwd(ctx: PiExtensionContext | undefined): string | undefined {
  return typeof ctx?.cwd === 'string' && ctx.cwd.trim().length > 0 ? ctx.cwd.trim() : undefined;
}

/** One integration per operation, bound to the live observation of that operation's context. */
function integrationFor(observation: ObservedSession) {
  const version = readAdapterVersion();
  if (version === undefined) return undefined;
  return createHostAuthorizedAdapterIntegration(
    {
      name: ADAPTER_NAME,
      version,
      observeEnvironment: () => ({ ok: true, observation: observation.observation }),
    },
    HOST_ADAPTER_AUTHORITY,
  );
}

function text(value: string, details: Record<string, unknown> = {}): { content: { type: 'text'; text: string }[]; details: Record<string, unknown> } {
  return { content: [{ type: 'text', text: value }], details };
}

/**
 * The v0.1.1 advanced invocation, preserved. The sealed release declared `authority` as the evidence
 * OBJECT beside `task_contract`; v0.1.2 renamed that evidence to `authority_evidence` and gave the
 * simple path the `authority` string. A published tool schema is a contract, so the old spelling is
 * translated here — before schema validation, which still sees the strict v0.1.2 shape — rather than
 * rejected by a schema the caller could not know had changed. A string `authority` is untouched: that
 * is the simple path. Stating both spellings is refused instead of silently preferring one.
 */
function prepareCompileArguments(args: unknown): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return args;
  const input = args as Record<string, unknown>;
  const legacy = input.authority;
  if (typeof legacy !== 'object' || legacy === null || Array.isArray(legacy)) return args;
  if (input.authority_evidence !== undefined) {
    throw new Error(
      'charter_compile refused: authority (the v0.1.1 evidence object) and authority_evidence are both present; state one authority evidence object',
    );
  }
  const { authority: _legacy, ...rest } = input;
  return { ...rest, authority_evidence: legacy };
}

/** The model profile the active session admits: every tier resolves to the model it observed. */
function modelProfileFor(observed: ObservedSession): Record<string, { preferred: string; fallback: never[] }> {
  return Object.fromEntries(MODEL_TIERS.map((tier) => [tier, { preferred: observed.observation.model, fallback: [] }]));
}

const compileTool: Parameters<PiExtensionApi['registerTool']>[0] = {
  name: TOOL_NAME,
  label: 'Charter Compile',
  description:
    'Compile bounded work into Charter governance. For normal use, state the intent directly (task, role, target, authority, scope, fresh, gates) — do not hand-author a contract. For target=subagents this returns a bounded delegation handoff (HANDOFF_READY) without claiming child execution; for target=parent it returns the bounded compile result for this session. Charter does not own or verify post-execution lifecycle. An advanced canonical contract may be passed as task_contract + authority_evidence instead; the released v0.1.1 spelling (task_contract + an authority evidence object) is still accepted.',
  promptSnippet: 'Compile bounded work into Charter governance immediately, from the stated intent',
  promptGuidelines: [
    'Use charter_compile as the first step for non-trivial bounded work: pass the intent fields directly (task, role, target, authority, scope, fresh, gates). Do not read Charter sources, dist/declarations, or Pi config to construct a request, and do not hand-author TaskContract JSON for normal work.',
    'Read the result as compile-time governance truth only: authority/scope/model/target capability are resolved without claiming that later execution occurred.',
    'For target=subagents, HANDOFF_READY means bounded delegation parameters exist; it never proves child execution. For target=parent, execution remains owned by Pi after compilation.',
  ],
  parameters: {
    type: 'object',
    properties: {
      // ── Normal operator intent ──────────────────────────────────────────────
      task: { type: 'string', description: 'What the bounded work is, in one short statement.' },
      role: {
        type: 'string',
        enum: ['planner', 'implement', 'review', 'correct', 'adjudicate'],
        description: 'The governance role. `implement` for bounded implementation; `review` for read-only conformance review.',
      },
      target: {
        type: 'string',
        enum: ['parent', 'subagents'],
        description: 'Where the work executes: `parent` (this session) or `subagents` (delegated to a child).',
      },
      authority: {
        type: 'string',
        description:
          'The authority document this work is bounded by, as a path relative to the root (e.g. `CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md`). Charter binds its content identity itself; never construct binder internals.',
      },
      scope: {
        type: 'array',
        items: { type: 'string' },
        description: 'The bounded scope, e.g. ["internal/store/**"]. Required when the role may write code.',
      },
      root: { type: 'string', description: 'Absolute repository root. Omit to use the session working directory.' },
      fresh: {
        type: 'string',
        enum: ['required', 'not_required'],
        description: 'Whether the delegated work must run in a fresh child session (subagents only). A requirement, never a claim about the child.',
      },
      gates: {
        type: 'array',
        items: { type: 'string' },
        description: 'The acceptance command gates, e.g. ["go test ./internal/store/...", "go vet ./internal/store/..."].',
      },
      correction_authority: {
        type: 'array',
        description:
          'Accepted correction targets, for role=correct: one entry per finding, stating the target id and the two evidence references that authorize it (the finding itself, and the explicit owner acceptance of it). Converted package-side into the live correction-authority binder — the operator never constructs binder internals. Stating a target admits nothing by itself: an unstated, unknown, or ambiguous reference is not admitted.',
        items: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              description: 'The correction target id, exactly as the contract scope declares it (e.g. P1).',
            },
            finding: {
              type: 'string',
              description: 'Evidence reference for the finding itself (e.g. review-finding:P1: the review that reported it).',
            },
            acceptance: {
              type: 'string',
              description: 'Evidence reference for the explicit owner acceptance of that finding.',
            },
          },
          required: ['target', 'finding', 'acceptance'],
          additionalProperties: false,
        },
      },
      // ── Advanced path (unchanged) ───────────────────────────────────────────
      task_contract: {
        type: 'object',
        description:
          'Advanced: the full canonical TaskContract (version, task, role, execution_target, root, authority, scope, permissions, acceptance, verification). Use only when the intent fields cannot express the request.',
      },
      authority_evidence: {
        type: 'object',
        description:
          'Advanced: the exact authority evidence for one reference named in task_contract.authority.sources. The released v0.1.1 spelling — the same object as `authority` beside task_contract — is still accepted.',
        properties: {
          source: { type: 'string', description: 'The authority reference, exactly as task_contract.authority.sources declares it.' },
          doc: { type: 'string', description: 'Identity of the authority document this reference resolves to.' },
          revision: { type: 'string', description: 'Revision of that authority document. Use an explicit value, not "latest".' },
        },
        required: ['source', 'doc'],
        additionalProperties: false,
      },
    },
    required: [],
    additionalProperties: false,
  },

  // The one compatibility seam: a legacy `authority` evidence object becomes `authority_evidence`
  // before the strict schema below validates it (the schema itself stays string-only for `authority`).
  prepareArguments: prepareCompileArguments,

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const observed = observeSession(ctx);
    if (!observed.ok) return text(`Charter compile refused: ${observed.reason}`);

    const cwd = sessionCwd(ctx);
    if (cwd === undefined) {
      return text('Charter compile refused: the active session does not report a working directory, so a root cannot be established');
    }
    const normalized = normalizeOperatorRequest(params, { cwd });
    if (!normalized.ok) return text(renderRefusal(normalized.errors), { ok: false, errors: normalized.errors });

    return compileRequest(normalized.request, observed);
  },
};

/**
 * Compile the normalized request on the path its target selects.
 *
 * The parent path compiles bounded governance from the host-observed session. The delegation path
 * compiles bounded authority for a child handoff without claiming child execution. Neither path owns
 * post-execution lifecycle or mints an execution handle.
 */
async function compileRequest(
  request: NormalizedOperatorRequest,
  observed: ObservedSession,
): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, unknown> }> {
  const modelProfile = modelProfileFor(observed);

  if (request.task_contract.execution_target === 'subagents') {
    const delegation = compileDelegation({
      task_contract: request.task_contract,
      authority_binder: request.authority_binder,
      correction_binder: request.correction_binder,
      model_profile: modelProfile,
      // The CLAIM channel: what this environment admits, and nothing about the child.
      available: [observed.observation.model],
      fresh_context: request.fresh_context,
    });
    if (!delegation.ok) {
      return text(renderRefusal(delegation.errors), { ok: false, errors: delegation.errors });
    }
    return {
      content: [{ type: 'text', text: renderDelegationCompile(delegation) }],
      details: {
        ok: true,
        request_kind: request.request_kind,
        status: delegation.status,
        execution_target: 'subagents',
        truth: delegation.truth,
        handoff: delegation.handoff,
        receipt_identity: delegation.compiled.resolution_receipt.receipt_identity,
        execution_contract_identity: delegation.compiled.resolution_receipt.execution_contract_identity,
        compiler_identity: delegation.compiled.resolution_receipt.compiler_identity,
        enforcement_truth: delegation.compiled.resolution_receipt.enforcement_truth,
        // Deliberately no post-execution handle: Charter stops at bounded compilation/handoff.
      },
    };
  }

  const integration = integrationFor(observed);
  if (integration === undefined) {
    return text('Charter compile refused: this integration cannot read its own package identity');
  }
  const compiled = integration.compile({
    task_contract: request.task_contract,
    authority_binder: request.authority_binder,
    correction_binder: request.correction_binder,
    model_profile: modelProfile,
  });
  if (!compiled.ok) {
    return text(renderRefusal(compiled.errors), { ok: false, errors: compiled.errors });
  }

  const receipt = compiled.compiled.resolution_receipt;
  return {
    content: [
      {
        type: 'text',
        text: renderParentCompile({ compiled: compiled.compiled }),
      },
    ],
    details: {
      ok: true,
      request_kind: request.request_kind,
      status: 'COMPILED',
      execution_target: 'parent',
      receipt_identity: receipt.receipt_identity,
      execution_contract_identity: receipt.execution_contract_identity,
      compiler_identity: receipt.compiler_identity,
      resolved_model: receipt.model,
      model_availability_evidence: receipt.model_availability_evidence.class,
      capability_evidence: receipt.capability_evidence.class,
      enforcement_truth: receipt.enforcement_truth,
      rendered_role_envelope: compiled.compiled.rendered_role_envelope,
    },
  };
}

/** Register the single compile operation. Charter owns no post-execution lifecycle. */
export default function piCharterIntegration(pi: PiExtensionApi): void {
  pi.registerTool(compileTool);
}
