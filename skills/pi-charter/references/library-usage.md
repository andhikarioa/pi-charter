---
title: Library Usage Reference
purpose: How to invoke pi-charter correctly — blessed facade first, Pi integration second, adapter contract for other substrates, low-level API as advanced use
audience: agents and developers using pi-charter
---

# Library Usage

## Read this first: use the blessed facade

`compileForTarget` is the one supported production entry. It composes the canonical pipeline
internally — resolve → canonical target binding → role envelope → render → target handoff →
resolution receipt — so you never assemble those steps by hand:

```ts
import { compileForTarget } from 'pi-charter';

const result = compileForTarget({
  task_contract: taskContract,
  authority_binder: authorityBinder,
  assertion_binder: assertionBinder,     // required when the contract declares assertions
  correction_binder: correctionBinder,   // required when the role is 'correct'
  model_profile: profile,
  available,                             // CLAIM channel (weak, recorded as a claim)
  // model_availability_attestation + model_availability_attestation_verifier  → attested channel
  capability_claim,                      // CLAIM channel — can never produce ENFORCED
  // capability_attestation + capability_attestation_verifier                  → attested channel
});

if (!result.ok) {
  // inspect result.errors (exact code + path + message) and STOP
}

const {
  execution_contract, target_binding, role_envelope, rendered_role_envelope, target_handoff,
  resolution_receipt,
} = result.compiled;
```

Non-negotiable composition rules the facade enforces for you:

- The envelope is compiled from `target_binding`, the canonically bound artifact. A hand-built,
  copied, cloned, or JSON-roundtripped binding compiles **nothing**.
- `target_handoff` is a separate artifact (target adapter parameters). Never feed it back into
  envelope compilation, and never present it as a `RoleEnvelope`.
- `resolution_receipt.compiler_identity` is the real build identity of the compiled package
  (a digest over the emitted `dist/` artifact set). You never invent it.
- No field exists for `role`, `model`, `permissions`, `enforcement_truth`, or a resolved contract:
  a caller supplies inputs, never intermediate artifacts.

## From Pi: prefer the bundled integration

Pi loads the package's extension and exposes two tools. That is the Pi-native surface: no handwritten
script, no environment strings, no trust handed to the caller.

```text
charter_compile           compile a bounded contract for the active session; returns the execution
                          handle for the exact artifact set it admitted
charter_verify_execution  verify an observed run of this session, using that handle
```

If you are writing TypeScript inside the Pi process, the library bridge is the same integration:

```ts
import { compileViaPi, observeExecutionViaPi, verifyExecutionViaPi } from 'pi-charter';

const compiled = compileViaPi({
  task_contract: taskContract,
  authority_binder: authorityBinder,
  model_profile: profile,
});
if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));

// later, once this session actually ran the work: report that execution observation, then verify.
// The handle proves which artifact set was admitted; the observation proves it ran, and in which
// session. Admission alone is not execution and does not verify.
observeExecutionViaPi({ execution_handle: compiled.execution_handle });
const verified = verifyExecutionViaPi({
  execution_handle: compiled.execution_handle,   // required — artifacts alone are not execution evidence
  resolution_receipt: compiled.compiled.resolution_receipt,
  role_envelope: compiled.compiled.role_envelope,
  execution_contract: compiled.compiled.execution_contract,
});
```

Bridge facts to rely on:

- It mediates the **active `parent` session only**. A `subagents` contract is refused, not answered
  with evidence about a runtime the bridge cannot see.
- An admitted artifact set nothing reported executing is **refused**, and a run observed in one
  session does not verify as a run of another: execution evidence binds the observed session.
- Capability booleans and model lists are **not accepted** from the caller; supplying them is an
  error, not an override.
- It claims no capability it cannot observe, so nothing reaches `ENFORCED` on the bridge path, and a
  contract that requires hard enforcement refuses to compile there.
- It attests no fresh session, tool ceiling, or verifier outcome. A contract requiring those gets a
  truthful deviation (`FRESH_SESSION_NOT_EVIDENCED`, `TOOL_POLICY_NOT_EVIDENCED`,
  `ACCEPTANCE_NOT_VERIFIED`), never a green result built on silence.
- Compilation admits the exact artifact set and returns an opaque execution handle. Verification
  without a handle is refused; verification with a handle for different artifacts is
  `NON_CONFORMANT`. Same session, same model, different governance artifact is not a pass.
- It spawns nothing, schedules nothing, persists nothing, and returns values.

## Environment evidence: claim vs attestation

Every environment input arrives through one of two channels, and the two are never blended:

| Channel | What it is | What it can produce |
|---|---|---|
| `available`, `capability_claim` | a raw CLAIM, recorded as `unattested_claim` | claims; never `ENFORCED`, never attested inventory |
| `*_attestation` + `*_attestation_verifier` | a candidate plus the trust boundary that vouches for it | `attested` evidence, and only for what was vouched for |

A source name, a source kind, a realistic version string, and a boundary-shaped record establish
nothing. Trust is a capability the environment holds: without the exact boundary that issued a
candidate, the candidate is recorded as the claim it is. With no attested capability, policy-bearing
dimensions resolve to `INSTRUCTED`, and `model_selection` to `UNSUPPORTED`.

## Execution evidence: receipt vs attestation

A `ResolutionReceipt` proves what was **compiled**. It says nothing about what ran. Execution
evidence is separate:

```ts
import { verifyExecutionAttestation } from 'pi-charter';

const verdict = verifyExecutionAttestation({
  execution_attestation,
  resolution_receipt,
  role_envelope,
  execution_contract,
});
```

- Verdict is `EXECUTION_CONFORMANT` or `NON_CONFORMANT` with exact deviations. No score, no partial
  pass, no lifecycle.
- Acceptance is reported separately: `ACCEPTANCE_VERIFIED`, `ACCEPTANCE_NOT_VERIFIED`, or
  `ACCEPTANCE_NOT_DECLARED`. Bound assertions stay `ASSERTION_BOUND` until evidence shows the exact
  bound verifier ran and passed for that reference.
- Only required dimensions are demanded: no tool policy → no tool evidence; no declared assertions →
  no verifier outcomes; nothing marked `required` → no enforcement evidence.
- Evidence must be **issued** by an execution-attestation boundary in the same process. A
  caller-authored object with every field correct is `UNTRUSTED_EXECUTION_EVIDENCE`.
- Conformance requires the **exact artifact link**. Evidence is issued from the admission the
  compile minted, and the artifacts you present are checked against it: an artifact supplied only at
  verification time is a claim about a run, never proof that this process admitted it.

## Adapter integration — for a substrate that owns its runtime

A legitimate adapter integrates through the supported public contract. It supplies OBSERVATIONS; core
owns TRUST PROMOTION. The adapter never sees an issuer, a verifier factory, or a boundary store:

```ts
import { createAdapterIntegration } from 'pi-charter';

const adapter = createAdapterIntegration({
  name: 'my-substrate-adapter',
  version: '1.0.0',
  observeEnvironment: () => ({
    ok: true,
    observation: {
      target: 'subagents',            // the runtime this adapter actually is
      provider: observedProvider,     // observed, never accepted from a caller
      model: observedModel,
      session_identity: observedSession,
      runtime: process.version,
    },
  }),
  // Report ONLY what this adapter observed about its own runtime. Omitted axes stay unattested.
  observeCapabilities: () => ({ ok: true, observed: { fresh_session: true } }),
});

const compiled = adapter.compile({ task_contract, authority_binder, model_profile });
// … the substrate runs the admitted artifact set …
// The runtime owner reports the execution it observed: admission alone is not execution.
adapter.observeExecution({ execution_handle: compiled.execution_handle });
const verified = adapter.verifyExecution({ execution_handle: compiled.execution_handle });
```

Rules the contract enforces:

- There is no parameter for capability booleans, model inventories, trust boundaries, or compiler
  identity; supplying them is refused by name.
- Capability observations are facts, not trust flags: `true` means observed, `false` means observed
  absent, an omitted axis means nothing was observed, and `attested: true` is refused. Core owns the
  promotion, so only an observed axis can become trusted evidence.
- A dimension the adapter cannot observe is never attested, and nothing is inferred from a target or
  adapter name. An axis no observer reported is recorded as an explicit unattested claim, so a hard
  requirement refuses instead of passing on silence.
- An unusable or partial observation fails closed; the adapter's returned facts are the only trusted
  facts, and they are promoted by core.

## Low-level API — advanced and internal use only

These remain public for adapters, integrations, and audits. Use them only when the facade genuinely
cannot express what you need, and reproduce the canonical order exactly:

```ts
resolveExecutionContract → bindExecutionTarget → compileBoundRoleEnvelope
→ renderRoleEnvelope → bindParentTarget / bindSubagentsTarget → createResolutionReceipt
```

```ts
import { bindExecutionTarget, compileBoundRoleEnvelope } from 'pi-charter';

const binding = bindExecutionTarget({ execution_contract, capability_claim });
const envelope = compileBoundRoleEnvelope(binding.binding); // must be binding.binding itself
```

Low-level cautions:

- `bindParentTarget` / `bindSubagentsTarget` return a target **handoff** translated from bound truth.
  They are not an envelope input, and their result is not a canonical binding.
- `createResolutionReceipt` re-runs the pipeline from the same environment inputs and refuses a
  claimed binding that does not equal what those inputs produce. Pass the exact artifacts you got.
- Neither `createAttestationVerifier` nor `createExecutionAttestationIssuer` is on the package
  surface. An ordinary consumer cannot mint trust at all; use `createAdapterIntegration` for a
  substrate integration, and never deep-import internal modules.

## Optional advanced surfaces

### Next action decision

```ts
import { decideNextAction } from 'pi-charter';

const decision = decideNextAction({
  role_envelope,
  outcome: 'MECHANICAL_FAILURE',
  counters: { clean_retries_used: 0, correction_rounds_used: 0, semantic_escalations_used: 0 },
});
```

Input is an explicit `RoleEnvelope` + outcome + counters → one decision. **It does not execute the
action**, and Charter performs no retry itself.

### Resolution receipt, low-level

```ts
import { createResolutionReceipt } from 'pi-charter';

const receipt = createResolutionReceipt({
  task_contract,
  authority_binder,
  assertion_binder,               // required when assertions are declared
  model_profile,
  available,                      // claim channel; attestation + verifier is the strong channel
  capability_claim,
  compiler_identity,              // the build identity of the running compiled package
  target_binding,                 // the canonical binding from this same run
});
```

A receipt is optional evidence: deterministic identities, no persistence, no cache, no workflow
authority, and never run history.

## Minimum end-to-end sample (facade only)

```ts
import {
  compileForTarget,
  createAuthorityBinder,
  verifyExecutionAttestation,
  type ModelProfile,
  type TaskContract,
} from 'pi-charter';

const taskContract: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'bounded-fix', class: 'T2', risk: 'medium' },
  role: 'implement',
  execution_target: 'parent',
  root: '/absolute/project/root',
  authority: { sources: ['canonical-master'] },
  scope: { files: ['internal/example.go'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: { commands: ['go test ./...'] },
  verification: { level: 'V2' },
  limits: { correction_rounds: 1 },
  non_goals: ['architecture redesign'],
};

const authority_binder = createAuthorityBinder({ 'canonical-master': { doc: 'Approved spec v1' } });
const model_profile: ModelProfile = {
  workhorse: { preferred: 'claude-3-7-sonnet', fallback: ['claude-3-5-sonnet'] },
  reviewer: { preferred: 'gpt-4o', fallback: [] },
  reasoning: { preferred: 'o3-mini', fallback: [] },
};

const compiled = compileForTarget({
  task_contract: taskContract,
  authority_binder,
  model_profile,
  available: ['claude-3-7-sonnet', 'gpt-4o', 'o3-mini'],
  capability_claim: {
    name: 'parent',
    capabilities: {
      model_selection: true,
      fresh_session: false,
      tool_ceiling: false,
      file_scope_enforcement: false,
      independent_review: false,
    },
  },
});

if (!compiled.ok) throw new Error(`Charter refused: ${JSON.stringify(compiled.errors)}`);

console.log(compiled.compiled.rendered_role_envelope);
```
