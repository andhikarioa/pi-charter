/**
 * Pi-native Charter integration (v0.1.1 final correction — F3).
 *
 * This is the discoverable Pi surface: `package.json` declares `pi.extensions: ["./extensions"]`, so
 * Pi loads this module, and the module registers exactly two tools:
 *
 *   charter_compile           compile bounded governance for the active Pi session and admit it
 *   charter_verify_execution  verify what this session ran against the admitted artifact set
 *
 * Two properties are the point of the correction:
 *
 *   It observes the REAL runtime. Provider, model, and session identity come from the live Extension
 *   context (`ctx.model`, `ctx.sessionManager`), not from environment strings a script could set, and
 *   not from caller-supplied tool arguments. The tool parameters carry a contract and an authority
 *   reference — never environment evidence.
 *
 *   It hands out no trust. The tool calls the supported adapter contract, which promotes the observed
 *   facts into trusted evidence; the LLM-facing arguments have no capability booleans, no model
 *   inventory, no trust boundary, and no way to mint attestations. Execution verification requires the
 *   opaque handle the compile admitted: passing artifacts at verification time cannot substitute.
 *
 * The extension owns no scheduling, no session lifecycle, no persistence, and no execution. It maps
 * tool arguments, calls the compiled package, and returns values.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MODEL_TIERS, createAdapterIntegration, createAuthorityBinder } from '../dist/index.js';

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

/** One integration per operation, bound to the live observation of that operation's context. */
function integrationFor(observation: ObservedSession) {
  const version = readAdapterVersion();
  if (version === undefined) return undefined;
  return createAdapterIntegration({
    name: ADAPTER_NAME,
    version,
    observeEnvironment: () => ({ ok: true, observation: observation.observation }),
  });
}

function text(value: string): { content: { type: 'text'; text: string }[]; details: Record<string, unknown> } {
  return { content: [{ type: 'text', text: value }], details: {} };
}

const compileTool: Parameters<PiExtensionApi['registerTool']>[0] = {
  name: TOOL_NAMES[0],
  label: 'Charter Compile',
  description:
    'Compile a bounded TaskContract into Charter governance (resolution receipt, role envelope, enforcement truth) for the active Pi session, and admit that exact artifact set for execution verification.',
  promptSnippet: 'Compile bounded work into Charter governance for this session',
  promptGuidelines: [
    'Use charter_compile when a non-trivial task needs explicit bounded authority, scope, permissions, or verification before execution.',
    'charter_compile returns an execution_handle; keep it and pass it to charter_verify_execution once the work ran. Verification without that handle is refused.',
  ],
  parameters: {
    type: 'object',
    properties: {
      task_contract: {
        type: 'object',
        description: 'The bounded TaskContract (version, task, role, execution_target, root, authority, scope, permissions, acceptance, verification).',
      },
      authority: {
        type: 'object',
        description: 'The exact authority evidence for one reference named in task_contract.authority.sources.',
        properties: {
          source: { type: 'string', description: 'The authority reference, exactly as task_contract.authority.sources declares it.' },
          doc: { type: 'string', description: 'Identity of the authority document this reference resolves to.' },
          revision: { type: 'string', description: 'Revision of that authority document. Use an explicit value, not "latest".' },
        },
        required: ['source', 'doc'],
        additionalProperties: false,
      },
    },
    required: ['task_contract', 'authority'],
    additionalProperties: false,
  },

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const observed = observeSession(ctx);
    if (!observed.ok) return text(`Charter compile refused: ${observed.reason}`);
    const integration = integrationFor(observed);
    if (integration === undefined) return text('Charter compile refused: this integration cannot read its own package identity');

    const authority = params.authority as { source?: unknown; doc?: unknown; revision?: unknown } | undefined;
    if (typeof authority?.source !== 'string' || authority.source.trim().length === 0) {
      return text('Charter compile refused: authority.source is required and must name a reference from task_contract.authority.sources');
    }
    if (typeof authority.doc !== 'string' || authority.doc.trim().length === 0) {
      return text('Charter compile refused: authority.doc is required and must identify the exact authority content');
    }

    const authorityBinder = createAuthorityBinder({
      [authority.source.trim()]: {
        doc: authority.doc.trim(),
        ...(typeof authority.revision === 'string' && authority.revision.trim().length > 0
          ? { revision: authority.revision.trim() }
          : {}),
      },
    });
    const modelProfile = Object.fromEntries(
      MODEL_TIERS.map((tier) => [tier, { preferred: observed.observation.model, fallback: [] }]),
    );

    const compiled = integration.compile({
      task_contract: params.task_contract,
      authority_binder: authorityBinder,
      model_profile: modelProfile,
    });
    if (!compiled.ok) {
      const summary = compiled.errors.map((error) => `${error.code}${error.path ? ` @ ${error.path}` : ''}: ${error.message}`);
      return { content: [{ type: 'text', text: `Charter compile refused:\n${summary.join('\n')}` }], details: { ok: false, errors: compiled.errors } };
    }

    const receipt = compiled.compiled.resolution_receipt;
    return {
      content: [
        {
          type: 'text',
          text:
            `Charter compiled ${receipt.task_contract_identity} for the active parent session as ${receipt.resolved_role}.\n` +
            `receipt_identity: ${receipt.receipt_identity}\n` +
            `execution_handle: ${compiled.execution_handle}\n` +
            'Pass execution_handle to charter_verify_execution after the work ran.',
        },
      ],
      details: {
        ok: true,
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
  },
};

const verifyTool: Parameters<PiExtensionApi['registerTool']>[0] = {
  name: TOOL_NAMES[1],
  label: 'Charter Verify Execution',
  description:
    'Verify what the active Pi session actually ran against the exact governance artifact set that charter_compile admitted, using the execution handle it returned.',
  promptSnippet: 'Verify this session actually ran the admitted Charter governance',
  promptGuidelines: [
    'Use charter_verify_execution only with an execution_handle returned by charter_compile in this session; artifacts alone are not execution evidence and are refused.',
  ],
  parameters: {
    type: 'object',
    properties: {
      execution_handle: {
        type: 'string',
        description: 'The execution handle returned by charter_compile for the artifact set being verified.',
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
    const deviations = verification.deviations.map((deviation) => `${deviation.code} @ ${deviation.path}: ${deviation.detail}`);
    return {
      content: [
        {
          type: 'text',
          text:
            `Charter execution verdict: ${verification.verdict}\n` +
            `acceptance: ${verification.acceptance.status}` +
            (deviations.length > 0 ? `\ndeviations:\n${deviations.join('\n')}` : ''),
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

/** Register the two operations. Pi loads this default export as the extension factory. */
export default function piCharterIntegration(pi: PiExtensionApi): void {
  pi.registerTool(compileTool);
  pi.registerTool(verifyTool);
}
