# pi-charter

Pi Charter is a small, fail-closed governance compiler for bounded Pi coding work.

It answers six questions before work starts:

1. What is the task and role?
2. What authority actually binds it?
3. What scope is allowed?
4. What model/target is resolved?
5. What can the runtime really enforce versus merely instruct?
6. What bounded instruction and receipt should Pi receive?

It does **not** execute the work, manage workers, schedule retries, track run lifecycle, or prove post-execution success.

## Mental model

```text
TASK
  ↓
AUTHORITY + SCOPE
  ↓
MODEL + TARGET CAPABILITY
  ↓
ENFORCEMENT TRUTH
  ↓
BOUNDED INSTRUCTION
  ↓
MINIMAL RECEIPT
```

For architecture and protected invariants, read [`ARCHITECTURE.md`](./ARCHITECTURE.md). Ordinary maintenance should not require the historical master build spec.

## Pi-native use

Pi loads exactly one Charter tool:

```text
charter_compile
```

Normal use supplies intent directly:

```text
task      what to do
role      planner | implement | review | correct | adjudicate
target    parent | subagents
authority root-relative authority document
scope     bounded paths
fresh     required | not_required
gates     acceptance commands
```

Example intent:

```text
task: Fix the parser bug described by PLAN.md
role: implement
target: parent
authority: PLAN.md
scope: ["src/parser/**"]
gates: ["npm test"]
```

A successful parent compile is presented approximately as:

```text
ALLOWED

Role          implement
Target        parent
Model         <resolved model>
Scope         src/parser/**

Authority     BOUND
Enforcement   <truth by constraint>
Acceptance    commands DECLARED (1); verifier evidence UNAVAILABLE

Charter compiled bounded governance for this task. Execution remains owned by Pi.
```

A refused request starts with `REFUSED` and states the reason, whether retry is meaningful, and the minimal remedy. Charter never widens authority to make a request pass.

## Enforcement truth

Charter uses four meanings and keeps them distinct:

| Truth | Meaning |
|---|---|
| `ENFORCED` | A trusted runtime observation supports a real substrate primitive for the applicable policy. |
| `INSTRUCTED` | The policy reaches the agent as instruction, but no hard runtime primitive is proven. |
| `UNSUPPORTED` | The required primitive cannot truthfully be supplied by this target. |
| `NOT_APPLICABLE` | No policy exists for that dimension. |

A caller claim can never promote itself to `ENFORCED`.

Current first-party Pi integration observes active provider/model/session identity. It does not fabricate capability attestation for primitives Pi does not expose.

## Authority and scope

Authority is evidence, not a label. The Pi-native path resolves the declared root-relative authority document and binds its content identity. Missing, ambiguous, unreadable, or root-escaping authority fails closed.

Scope is likewise fail-closed:

- write-capable roles require bounded scope;
- lexical or real filesystem escape is refused;
- scope never silently broadens;
- review-only roles remain read-only;
- correction authority is limited to accepted named findings/targets.

## Fresh-session review semantics

`fresh: required` means a delegated child must use a fresh session/context.

It does **not** by itself mean:

- external audit,
- organizational independence,
- independent toolchain,
- or runtime-attested independence.

A canonical contract may require stronger independent-review semantics only when the selected target can truthfully satisfy them. Otherwise Charter refuses rather than relabeling freshness as independence.

## Parent versus subagents

### `parent`

Charter compiles governance for the active Pi session. After compilation, Pi owns execution. Charter has no post-run execution handle or verifier.

### `subagents`

Charter returns a bounded handoff. `HANDOFF_READY` means the delegation parameters are ready; it never proves that a child started, used a particular model, or completed the work.

## Acceptance truth

Command gates and verifier-bound assertions are distinct:

```text
Acceptance commands   DECLARED / NONE
Verifier evidence     ASSERTION_BOUND, NOT VERIFIED / UNAVAILABLE
```

A declared command is not evidence that it passed. Charter intentionally owns no post-execution acceptance lifecycle.

## TypeScript API

The supported package surface is intentionally small. Use the high-level facade rather than composing compiler phases manually.

```ts
import {
  compileForTarget,
  compileDelegation,
  createAdapterIntegration,
  createAuthorityBinder,
  createEvidenceBinder,
  type TaskContract,
  type ModelProfile,
} from 'pi-charter';
```

Primary entry points:

- `compileForTarget` — canonical bounded compile facade.
- `compileDelegation` — bounded `subagents` handoff; no child execution claim.
- `createAdapterIntegration` — ordinary external-runtime integration. Its observations are candidates, not trusted host attestation.

Resolution, target binding, instruction construction, receipt construction, the Pi bridge, and trust minters are implementation details, not public composition APIs.

A successful facade compile already includes:

```ts
result.compiled.execution_contract
result.compiled.target_binding
result.compiled.rendered_role_envelope
result.compiled.target_handoff
result.compiled.resolution_receipt
```

The receipt is a deterministic projection of the same canonical compile truth. It does not rerun resolution and is not run history.

## What Charter intentionally does not own

Charter has no:

- worker/runtime scheduler;
- lease or execution registry;
- retry/escalation lifecycle;
- execution handle;
- post-run conformance verifier;
- persistent run ledger;
- plugin/provider framework;
- automatic external audit claim.

Those boundaries are deliberate.

## Verification

```bash
npm run typecheck
npm test
npm run smoke:compiler
npm run smoke:consumer
npm run smoke:pi       # when Pi is installed in the environment
npm pack --dry-run
```

`npm test` builds the package and runs the deterministic test suite. `smoke:compiler` checks compiler-artifact identity tamper detection. `smoke:consumer` installs the packed package into an external consumer and verifies the supported public surface. `smoke:pi` verifies the Pi-native one-tool integration when Pi is available.

## Release minimum

For this private one-operator package, the intended release path is deliberately boring:

```text
typecheck
→ tests
→ compiler smoke
→ consumer smoke
→ Pi smoke when available
→ npm pack --dry-run
→ tag
→ push
→ short release note
```

Git history and tags are the release identity. No separate sealing framework is required.

## Repository docs

Active maintainership docs:

- `README.md` — usage and current product truth.
- `ARCHITECTURE.md` — one-page mental model and protected invariants.
- `PI-CHARTER-LEAN-ARCHITECTURE-AUDIT.md` — evidence behind the slimming decision.
- `PI-CHARTER-SLIMMING-BUILD-PLAN.md` — bounded wave authority for this slimming cycle.
- `CHANGELOG.md` — short current change record.

Historical build/dogfood documents remain in the repository as history, but are not required reading for ordinary maintenance.

## Current constraints

- Runtime dependencies: zero.
- Supported execution targets: `parent`, `subagents`.
- Pi-native public tool count: one (`charter_compile`).
- Package does not claim execution proof after compile/handoff.
- Task class/risk/V-level taxonomy remains current contract vocabulary; this slimming cycle intentionally does not redesign it.
