/**
 * Pi-native Charter integration (v0.1.2 Wave 1 — CN0–CN5).
 *
 * This is the discoverable Pi surface: `package.json` declares `pi.extensions: ["./extensions"]`, so
 * Pi loads this module, and the module registers exactly two tools:
 *
 *   charter_compile           compile bounded governance for this session, or bounded delegation
 *                             authority for a subagents target, and admit the parent artifact set
 *   charter_verify_execution  verify what this session ran against the admitted artifact set
 *
 * v0.1.2 separates two questions this surface used to conflate:
 *
 *   A.  Can Charter compile bounded authority for this target?    → YES, for parent and subagents
 *   B.  Can Charter attest the target runtime?                    → ONLY for the session it observes
 *
 * For `execution_target=subagents` the tool compiles the authority, returns a bounded handoff, and
 * says plainly that it observed no child runtime: no capability is attested, no model is claimed for
 * the child, no execution handle is minted (a handle here would let this session's own tool calls be
 * verified as the child's run), and `charter_verify_execution` therefore has nothing to verify. The
 * weaker truth is the product; the impossibility of the stronger claim is not a failure.
 *
 * Two other properties remain exactly as v0.1.1 established them:
 *
 *   It observes the REAL runtime. Provider, model, and session identity come from the live Extension
 *   context (`ctx.model`, `ctx.sessionManager`), never from environment strings or tool arguments. The
 *   tool parameters carry normal operator intent (or an advanced canonical contract) — never
 *   environment evidence.
 *
 *   It hands out no trust. The parent path calls the supported adapter contract from the
 *   HOST-AUTHORIZED position, which promotes the observed facts into trusted evidence; the LLM-facing
 *   arguments have no capability booleans, no model inventory, no trust boundary, and no way to mint
 *   attestations. Execution verification requires the opaque handle the compile admitted AND an
 *   observed execution of it: passing artifacts at verification time cannot substitute, and neither
 *   can calling verify immediately after compile.
 *
 * Normal operation is tool-first and archaeology-free: parse intent, call `charter_compile` once,
 * consume the handoff or the refusal, continue. The extension reads exactly one file the operator
 * names — the authority document of a simple request — and never Charter's own sources.
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
  renderVerification,
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
  /**
   * Pi's event subscription. This extension uses exactly one event: the moment a tool actually
   * executes in the session, which is the substrate's own observation that work ran.
   */
  on?(event: 'tool_execution_start', handler: (event: ToolExecutionStartEvent, ctx: PiExtensionContext) => void): void;
}

/** The only part of a Pi tool-execution event this extension reads. */
interface ToolExecutionStartEvent {
  toolName?: unknown;
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

const TOOL_NAMES = ['charter_compile', 'charter_verify_execution'] as const;

/**
 * Handles this extension admitted, by the session that admitted them, so a tool executing in that
 * session can be reported as the substrate's execution observation. Bounded FIFO, process-local: this
 * is an observation window, not a run history, and it holds no artifacts.
 *
 * Only a parent compile ever enters this map. A delegation compile admits nothing, so it has no handle
 * and no entry — this session's tool executions are this session's work, never the child's.
 */
const PENDING_EXECUTION = new Map<string, string>();
const MAX_PENDING_EXECUTION = 16;

function rememberPendingExecution(sessionIdentity: string, handle: string): void {
  PENDING_EXECUTION.delete(sessionIdentity);
  PENDING_EXECUTION.set(sessionIdentity, handle);
  while (PENDING_EXECUTION.size > MAX_PENDING_EXECUTION) {
    const oldest = PENDING_EXECUTION.keys().next().value;
    if (oldest === undefined) break;
    PENDING_EXECUTION.delete(oldest);
  }
}

/**
 * The substrate's execution observation (F1). Pi reports that a tool is executing in this session;
 * a tool that is not one of this extension's own operations is work running, and that is reported
 * against the handle admitted for this session. Compiling admits an artifact set and verifying
 * inspects one, so neither is execution: without this observation, verification refuses.
 */
function observeToolExecution(event: ToolExecutionStartEvent, ctx: PiExtensionContext | undefined): void {
  const toolName = typeof event?.toolName === 'string' ? event.toolName : undefined;
  if (toolName === undefined || (TOOL_NAMES as readonly string[]).includes(toolName)) return;
  const observed = observeSession(ctx);
  if (!observed.ok) return;
  const session = observed.observation.session_identity;
  const handle = PENDING_EXECUTION.get(session);
  if (handle === undefined) return;
  const integration = integrationFor(observed);
  if (integration === undefined) return;
  if (integration.observeExecution({ execution_handle: handle }).ok) PENDING_EXECUTION.delete(session);
}

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
  name: TOOL_NAMES[0],
  label: 'Charter Compile',
  description:
    'Compile bounded work into Charter governance. For normal use, state the intent directly (task, role, target, authority, scope, fresh, gates) — do not hand-author a contract. For target=subagents this returns a bounded delegation handoff (HANDOFF_READY) and states that no child runtime was observed; for target=parent it admits the artifact set and returns the execution handle that charter_verify_execution requires. An advanced canonical contract may be passed as task_contract + authority_evidence instead; the released v0.1.1 spelling (task_contract + an authority evidence object) is still accepted.',
  promptSnippet: 'Compile bounded work into Charter governance immediately, from the stated intent',
  promptGuidelines: [
    'Use charter_compile as the first step for non-trivial bounded work: pass the intent fields directly (task, role, target, authority, scope, fresh, gates). Do not read Charter sources, dist/declarations, or Pi config to construct a request, and do not hand-author TaskContract JSON for normal work.',
    'Read the result as four separate truths: Authority BOUND, Handoff READY, Runtime proof, Execution proof. A subagents compile never proves child execution; charter_verify_execution applies to the parent session only.',
    'For target=parent keep the returned execution_handle and pass it to charter_verify_execution once this session has run the work; verifying before any tool executed is refused.',
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
 * The parent path is unchanged from v0.1.1: the host-authorized integration observes this session and
 * admits the artifact set, returning the execution handle. The delegation path compiles bounded
 * authority only — it observes no runtime, mints no handle, and reports the weaker truth rather than
 * withholding a compilable delegation.
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
        // Deliberately absent: execution_handle. A child this process cannot observe is never admitted
        // for execution here, so no verification can be manufactured from this handoff.
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
  rememberPendingExecution(observed.observation.session_identity, compiled.execution_handle);
  return {
    content: [
      {
        type: 'text',
        text: renderParentCompile({
          compiled: compiled.compiled,
          execution_handle: compiled.execution_handle,
        }),
      },
    ],
    details: {
      ok: true,
      request_kind: request.request_kind,
      status: 'ADMITTED_FOR_EXECUTION',
      execution_target: 'parent',
      execution_handle: compiled.execution_handle,
      receipt_identity: receipt.receipt_identity,
      execution_contract_identity: receipt.execution_contract_identity,
      compiler_identity: receipt.compiler_identity,
      resolved_model: receipt.resolved_model.resolved,
      model_availability_evidence: receipt.model_availability_evidence.class,
      capability_evidence: receipt.capability_evidence.class,
      enforcement_truth: receipt.enforcement_truth,
      rendered_role_envelope: compiled.compiled.rendered_role_envelope,
    },
  };
}

const verifyTool: Parameters<PiExtensionApi['registerTool']>[0] = {
  name: TOOL_NAMES[1],
  label: 'Charter Verify Execution',
  description:
    'Verify a run of the active Pi session against the exact governance artifact set that charter_compile admitted for it, using the execution handle it returned. Refused when the session never executed work under that admission, and refused for a delegation handoff — that compiles authority for a child this process does not observe, so there is nothing here to verify.',
  promptSnippet: 'Verify this session actually ran the admitted Charter governance',
  promptGuidelines: [
    'Use charter_verify_execution only with an execution_handle returned by a target=parent charter_compile in this session; artifacts alone are not execution evidence and are refused.',
    'A subagents delegation compile returns no execution handle: child execution is not attested by this session, so do not attempt to verify it.',
  ],
  parameters: {
    type: 'object',
    properties: {
      execution_handle: {
        type: 'string',
        description: 'The execution handle returned by a target=parent charter_compile for the artifact set being verified.',
      },
    },
    required: ['execution_handle'],
    additionalProperties: false,
  },

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const observed = observeSession(ctx);
    if (!observed.ok) return text(`Charter verification refused: ${observed.reason}`);
    const integration = integrationFor(observed);
    if (integration === undefined) return text('Charter verification refused: this integration cannot read its own package identity');

    const handle = params.execution_handle;
    if (typeof handle !== 'string' || handle.trim().length === 0) {
      return text('Charter verification refused: execution_handle is required');
    }

    const result = integration.verifyExecution({ execution_handle: handle.trim() });
    if (!result.ok) return text(`Charter verification refused: ${result.reason}`);

    const verification = result.verification;
    return {
      content: [
        {
          type: 'text',
          text: renderVerification({
            verdict: verification.verdict,
            acceptance: verification.acceptance,
            deviations: verification.deviations,
          }),
        },
      ],
      details: {
        ok: true,
        verdict: verification.verdict,
        deviations: verification.deviations,
        acceptance: verification.acceptance,
        substrate: verification.substrate,
      },
    };
  },
};

/** Register the two operations, and Pi's execution event as the substrate observation (F1). */
export default function piCharterIntegration(pi: PiExtensionApi): void {
  pi.registerTool(compileTool);
  pi.registerTool(verifyTool);
  // Fail-closed if this Pi build cannot report tool execution: no observation is recorded, so
  // verification refuses instead of inferring execution from something that was never observed.
  if (typeof pi.on === 'function') pi.on('tool_execution_start', observeToolExecution);
}
