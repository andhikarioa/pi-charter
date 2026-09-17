# PI CHARTER — SLIMMING BUILD PLAN

**Status:** IMPLEMENTED AND RELEASED as `v0.2.0`.
**Planning-time status:** PLANNING COMPLETE — IMPLEMENTATION NOT STARTED (the state when this plan was frozen; kept so the line below cannot mislead)  
**Mode:** READ-ONLY PLANNING  
**Baseline:** `v0.1.2` / `9f560ad453f52938e8179d21f2df9f4e8134e33c`  
**Audit authority:** `PI-CHARTER-LEAN-ARCHITECTURE-AUDIT.md`  
**Audit SHA-256:** `a8434cd657fb3fb3cf59d4d601319d3298ec07da136fcfbe95259e36b1fb666a`

---

## 1. Goal

Slim Pi Charter without redesigning it.

Keep only machinery that protects: **intent, authority, scope, model truth, capability/enforcement truth, bounded instruction, minimal useful evidence**.

Target mental model:

`TASK → AUTHORITY + SCOPE → MODEL + CAPABILITY TRUTH → COMPILE → MINIMAL RECEIPT`

No v2. No rewrite. No runtime/control-plane ownership.

---

## 2. Authority order

1. Current `v0.1.2` observable protected behavior.
2. This build plan for slimming scope and wave boundaries.
3. Lean architecture audit for evidence/rationale.
4. Historical specs/releases as history only.

If source truth contradicts a protected invariant below: **STOP and report**.

---

## 3. Protected invariants

These survive every wave:

1. Explicit bounded task + role.
2. Authority is never invented.
3. Missing/ambiguous authority fails closed.
4. Bound authority retains concrete provenance/content identity.
5. Authority path/symlink cannot escape declared root.
6. Scope never silently widens; root escape fails closed.
7. Mutation-capable work requires bounded scope.
8. Read-only roles remain read-only.
9. Mutation/release/external-write authority is explicit.
10. Model resolution never silently substitutes; fallback is explicit only.
11. `ENFORCED`, `INSTRUCTED`, `UNSUPPORTED`, `NOT_APPLICABLE` remain distinct.
12. Caller claims can never self-promote to `ENFORCED`.
13. Unsupported hard requirement fails closed.
14. Unknown/contradictory governance-bearing input fails closed.
15. Compiled instruction preserves canonical authority/scope/role/permissions/model/target truth.
16. Subagent handoff never invents child execution proof.
17. Fresh-session review is never described as external independence.
18. Minimal deterministic compile evidence remains available for debugging/reconstruction.
19. Charter never becomes an execution runtime/control plane.

Do **not** freeze current phase count, receipt shape, internal artifact count, test count, execution handles, or escalation counters.

---

## 4. Locked decisions

| Mechanism | Decision |
|---|---|
| `ExecutionContract` | **KEEP** as single rich canonical resolved truth |
| authority/scope/model/enforcement core | **KEEP** |
| post-execution admission + `charter_verify_execution` | **DELETE** |
| execution handles / admission registries / execution attestation | **DELETE** |
| `decideNextAction` / escalation lifecycle | **DELETE** |
| correction/escalation counters + terminal policy | **DELETE WITH escalation** |
| `Jurisdiction` first-class object | **COLLAPSE** into derived instruction rules |
| `RoleEnvelope` | **COLLAPSE** to instruction-specific projection |
| `ResolutionReceipt` | **COLLAPSE** to deterministic projection; no recompilation |
| parent/subagent adapter rebinding | **REMOVE** |
| trusted observation vs caller claim | **KEEP**, simplify implementation |
| broad low-level SDK surface | **SHRINK HARD** |
| compiler identity/tamper detection | **KEEP THIS CYCLE** |
| `adjudicate` role | **KEEP THIS CYCLE** |
| task class / risk / V0–V5 taxonomy | **DEFER** unless directly orphaned |
| historical specs/releases | **KEEP HISTORY**; slim future active docs/process |

Do not reopen these decisions inside Builder sessions.

---

## 5. Target architecture

```text
Operator Request
  → normalize + structural validation
  → bind authority ONCE
  → semantic validation + model resolution
  → ExecutionContract        # single canonical resolved truth
  → bind target capability ONCE
  → TargetBinding
      ├─ target handoff projection
      ├─ bounded instruction projection
      └─ minimal receipt projection
```

**Ownership rule:** later stages consume canonical truth; they do not recreate it to prove it again.

---

# WAVE 1 — REMOVE NON-CORE LIFECYCLE OWNERSHIP

## Goal

Return Charter to a compile-time governance boundary before compressing compiler internals.

### 1A. Invariant freeze

Before deletion, confirm regression coverage for:

| Case | Required result |
|---|---|
| missing authority | REFUSE |
| ambiguous authority | REFUSE |
| authority root/symlink escape | REFUSE |
| write role + empty/unbounded scope | REFUSE |
| scope root escape | REFUSE |
| read-only role mutation | REFUSE |
| correction outside accepted target | REFUSE |
| unavailable model without fallback | REFUSE |
| explicit fallback | deterministic model |
| raw capability claim | never `ENFORCED` |
| policy without trusted primitive | `INSTRUCTED` |
| unsupported hard requirement | REFUSE |
| no applicable policy | `NOT_APPLICABLE` |
| unknown governance field | REFUSE |
| subagent handoff | no child execution claim |
| fresh session | no external-independence claim |

No new test framework. Reuse current coverage where possible.

### 1B. Delete post-execution verification

Remove: `ExecutionAdmission`, `ExecutionAttestation`, `execution_handle`, admission/pending registries, `observeExecution`, `verifyExecution`, `charter_verify_execution`, execution observation bridge, and `EXECUTION_CONFORMANT`-style post-run verdicts.

Concrete guarantee intentionally removed:

> This process admitted an artifact set, later observed some work in the same session/runtime, and selected artifact/session/model identities agreed.

Do **not** replace it.

Desired flow:

`parent: charter_compile → Pi works`  
`subagent: charter_compile → bounded handoff → substrate executes`

Charter makes no post-run conformance claim.

### 1C. Delete escalation lifecycle

Remove: `decideNextAction`, post-run outcome routing, correction-round counters, semantic-escalation counters, automatic retry/escalation decisions, and terminal policy.

A later review/correction/adjudication is simply a **new explicitly bounded Charter task**. Keep `correct` and `adjudicate` roles.

Remove direct orphan fields including `limits.correction_rounds`, `limits.semantic_escalations`, `ExecutionContract.terminal_state`, and RoleEnvelope terminal/escalation sections.

### 1D. File jurisdiction

Expected deletes:

- `src/core/execution/execution-attestation.ts`
- `src/core/execution/trusted-execution-boundary.ts`
- `src/core/execution/execution-attestation.test.ts`
- `src/core/escalation/escalation-policy.ts`
- `src/core/escalation/escalation-policy.test.ts`

Expected direct dependents only:

- `extensions/pi-charter.ts`
- `src/bridge/pi-bridge.ts`
- `src/integration/adapter-integration.ts`
- `src/operator/operator-surface.ts`
- `src/core/contracts/{task-contract,execution-contract}.ts`
- `src/core/validation/validate.ts`
- `src/core/resolver/resolve.ts`
- `src/core/envelopes/role-envelope.ts`
- `src/core/receipt/resolution-receipt.ts`
- `src/core/conformance/*`
- `src/index.ts`
- `scripts/pi-integration-smoke.mjs`
- `README.md` only for interface-truth correction
- directly corresponding tests/fixtures

Touch outside this set only when a compile/test failure proves a direct dependency. No opportunistic refactor.

### 1E. Test disposition

Delete subsystem tests with subsystem. Rewrite lifecycle-dependent tests. Preserve authority, scope, model routing, capability/enforcement truth, delegation, correction authority, and unknown-field rejection coverage.

**Test count may fall. That is expected.**

### 1F. Acceptance

- only `charter_compile` remains in Pi Charter tool surface;
- parent compile returns no execution handle;
- no execution admission/pending registry or attestation/verification API remains;
- no escalation/next-action API remains;
- lifecycle counters/terminal policy are absent from canonical compile artifacts;
- parent and subagent compilation still work;
- protected invariants remain covered;
- `npm run typecheck`, `npm test`, `npm run smoke:compiler`, `npm run smoke:consumer` PASS;
- `npm run smoke:pi` PASS when Pi exists, otherwise report `ENVIRONMENT_UNAVAILABLE` distinctly.

### 1G. STOP

Stop rather than redesign if a protected invariant truly depends on post-run lifecycle state, a real current non-test consumer requires execution handles, removing escalation changes authority/scope/enforcement truth, or progress requires replacement runtime/workflow machinery.

---

# WAVE 2 — COMPRESS THE GOLDEN COMPILE PATH

## Goal

Establish each governance truth once and stop copying/revalidating it across rich artifacts.

### 2A. Bind authority once

Target: `shape validation → bind each declared authority once → canonical provenance → downstream consumption`.

Add one regression test proving a successful high-level compile performs **one bind per declared authority reference**. No cache/registry framework.

### 2B. Bind target once

Target: `ExecutionContract → bindExecutionTarget ONCE → TargetBinding → adapters project already-bound truth`.

Parent/subagent adapters must not rebind.

### 2C. Collapse `Jurisdiction`

Delete `Jurisdiction` as canonical state. Preserve real rules directly from `role + permissions + scope + explicit task semantics` during instruction compilation.

Do not replace it with an equivalent renamed object.

### 2D. Thin `RoleEnvelope`

Keep instruction-specific responsibility only: objective, bounded operating rules, prohibitions, stop conditions, instruction identity, and reference/identity of canonical resolved truth.

Do not clone canonical model/scope/permissions/jurisdiction/enforcement state into another rich artifact. No replacement rich artifact.

### 2E. Thin `ResolutionReceipt`

Receipt becomes a deterministic projection of already-established compile truth. It must **not** validate TaskContract again, resolve authority/model again, or bind target again.

Retain only fields materially needed for reconstruction/debugging, centered on compiler/build identity, canonical contract identity, task/role/target/model, necessary authority provenance, enforcement truth, and receipt identity.

Do not retain fields solely for v0.1.2 shape compatibility.

### 2F. Simplify capability trust machinery

Preserve: `caller claim != trusted runtime observation`; caller claims never produce `ENFORCED`.

Truth semantics remain:

- trusted runtime observation → eligible for `ENFORCED`;
- policy + no trusted observation → `INSTRUCTED`;
- required unsupported primitive → `UNSUPPORTED` / REFUSE;
- no policy → `NOT_APPLICABLE`.

Internalize/remove generic verifier/boundary abstractions where unnecessary. No provider/plugin/strategy framework.

### 2G. Shrink TypeScript public surface

Public API should center on high-level compile facade, operator-facing input/output types, canonical task/resolved types, Charter errors, enforcement truth, and a small set of proven helpers.

Do not publicly expose internal compiler phases for hypothetical extensibility. No compatibility wrappers for removed internal symbols unless a real current consumer proves necessity.

Implementation report must show **named exports before → after**.

### 2H. File jurisdiction

Expected scope:

- `src/core/validation/validate.ts`
- `src/core/authority/binder.ts`
- `src/core/resolver/resolve.ts`
- `src/core/contracts/execution-contract.ts`
- `src/core/enforcement/target-binding.ts`
- `src/core/attestation/*`
- `src/core/jurisdiction/jurisdiction.ts` — expected DELETE
- `src/core/envelopes/role-envelope.ts`
- `src/core/receipt/resolution-receipt.ts`
- `src/core/compile/compile-for-target.ts`
- `src/adapters/{parent,subagents}/*`
- `src/delegation/compile-delegation.ts`
- `src/integration/adapter-integration.ts`
- `src/operator/{operator-request,operator-surface}.ts`
- `src/index.ts`
- directly corresponding tests

No broad docs/release cleanup here.

### 2I. Test disposition

Keep observable invariant tests. Rewrite tests coupled to old ownership. Delete tests whose sole purpose was defending removed public intermediate objects, e.g. forging removed phases, clone/copy attacks on removed boundaries, receipt-side recompilation checks, and Jurisdiction shape equality.

No zombie tests.

### 2J. Acceptance

- `ExecutionContract` is the one rich canonical resolved truth;
- each authority reference binds once on successful high-level compile;
- target capability binds once;
- adapters consume bound truth;
- `Jurisdiction` first-class object is gone;
- instruction artifact no longer clones the governance universe;
- receipt does not revalidate/reresolve/rebind;
- caller claims still cannot produce `ENFORCED`;
- unsupported hard requirements still fail closed;
- named public exports materially decrease;
- no new registry/factory/strategy/lifecycle abstraction appears;
- operator workflow is no more complex than before;
- retained verification suite PASS.

### 2K. STOP

Stop if simplification weakens enforcement honesty, one canonical authority result cannot represent required semantics, replacement design introduces as many concepts as it deletes, API compatibility pressure creates a large shim layer, or work expands into deferred task/risk/V0–V5 redesign.

---

# WAVE 3 — SURFACE / DOCS / PACKAGE CLEANUP

## Goal

Make the simplified repo easy to use and easy to re-enter after months away. No compiler redesign.

### 3A. Operator UX

Common output should be approximately:

```text
ALLOWED
role / authority / scope / target / model / enforcement
```

or:

```text
REFUSED
reason / remedy
```

Hide compiler-phase vocabulary unless it changes operator action.

### 3B. Review wording

Use precise distinctions: `fresh_session`, `runtime_attested_independence` only when real, and `user_approval`. Fresh LLM context is not an external audit.

### 3C. Active docs

Target active maintainership set:

- `README.md`
- `ARCHITECTURE.md` — short mental model + invariants
- `PI-CHARTER-LEAN-ARCHITECTURE-AUDIT.md`
- `PI-CHARTER-SLIMMING-BUILD-PLAN.md`
- short release/change record

Historical specs/releases remain untouched as history. Routine maintenance must not require the 2,303-line historical master spec.

### 3D. Package hygiene

Exclude test-only fixture code from npm package when production does not need it. Retain zero runtime dependencies unless proven otherwise. Add no packaging/build framework.

### 3E. Future release minimum

`typecheck → test → smoke:compiler → smoke:consumer → smoke:pi when available → npm pack --dry-run → tag → push → short release note`

No release-seal machinery unless a concrete future bug proves need.

### 3F. Acceptance

- README contains no deleted execution/escalation interface;
- review/freshness wording is precise;
- architecture can be recovered from one short active document;
- package excludes obvious test-only artifacts;
- consumer/package/Pi smoke passes;
- final parent + subagent dogfood is truthful;
- no extra operator step exists.

---

## 6. Test disposition summary

| Area | Disposition |
|---|---|
| validation | KEEP / shrink deleted-field cases |
| resolver | REWRITE around single ownership |
| target binding | KEEP / REWRITE |
| role envelope | REWRITE HEAVILY |
| receipt | REWRITE HEAVILY |
| execution attestation | DELETE |
| escalation policy | DELETE |
| compile-for-target | KEEP / strengthen as golden-path test |
| parent adapter | REWRITE |
| subagent adapter | KEEP / REWRITE |
| delegation / correction authority | KEEP |
| Pi bridge / integration | REWRITE HEAVILY |
| operator request | KEEP |
| operator surface | REWRITE |
| conformance | SHRINK TO INVARIANTS |
| proof boundary | SHRINK HARD |
| package surface | REWRITE for smaller SDK |
| compiler identity + compiler smoke | KEEP |
| consumer smoke | KEEP / UPDATE |
| Pi smoke | REWRITE for one-tool surface |

Test count is not a success metric.

---

## 7. Required metrics after each wave

Report:

| Metric | Desired direction |
|---|---|
| runtime/source LOC | ↓ |
| test/support LOC | ↓ |
| named public exports | ↓ |
| Pi tool count | `1` after Wave 1 |
| production module count | ↓ |
| package file count / unpacked size | ↓ |
| full tests | PASS |
| authority binds / golden compile | `1` per reference after Wave 2 |
| target binds / golden compile | `1` after Wave 2 |
| process-local execution lifecycle registries | `0` after Wave 1 |
| rich canonical governance artifacts | ↓ |
| operator turns: parent | ↓ |
| operator turns: subagent | = or ↓ |
| authority/scope truth | = |
| enforcement honesty | = |

---

## 8. No-go rules

Do not introduce: `pi-charter-next`, new policy DSL, event sourcing/execution ledger, scheduler/worker lifecycle/lease/recovery, persistent run state, single-implementation provider/plugin registry, strategy/factory layers without real multiplicity, replacement receipt framework, compatibility framework for removed internals, general workflow engine, or new vocabulary that merely renames old vocabulary.

No broad archaeology by default. Search outside wave jurisdiction only when a concrete compile/test error proves a missing dependency; stop once sufficient evidence exists.

---

## 9. Execution discipline

Per wave: **Builder → fresh Reviewer → Corrector only for material finding**.

Builder rules: current wave only; no web research; no subagents unless explicitly authorized; no architecture reopen; no future-wave work; minimum files; remove dead tests with dead subsystems; STOP when acceptance passes.

Reviewer checks only protected invariants, wave scope, truthful simplification, absence of replacement architecture, and verification results.

No extra re-review ceremony after a clean PASS.

---

## 10. Wave boundaries

- **Wave 1:** remove off-thesis consumers. Do not compress compiler internals.
- **Wave 2:** compress compiler truth ownership. Do not do broad docs/release cleanup.
- **Wave 3:** surface/docs/package only. Do not reopen compiler semantics.

This ordering avoids rewriting the same layer multiple times.

---

## 11. Expected reduction

Audit estimate, not target:

| Surface | Expected reduction |
|---|---:|
| production implementation complexity | ~30–45% |
| test/maintenance surface | ~35–50% |
| documentation/process burden | ~55–70% |
| operator-visible concepts | ~35–50% |
| conceptual/state-space complexity | ~40–55% |

Task/risk/V0–V5 taxonomy is deliberately deferred, so this cycle may land toward the conservative side.

---

## 12. Definition of done

Slimming is complete when:

1. protected authority/scope/model/enforcement behavior remains intact;
2. high-level compile binds authority and target truth once;
3. `ExecutionContract` is the single rich canonical resolved governance artifact;
4. instruction artifact does not clone the governance universe;
5. receipt is minimal and does not rerun compiler stages;
6. Charter holds no post-run admission/verification lifecycle state;
7. Charter owns no retry/escalation workflow lifecycle;
8. public SDK is materially smaller;
9. common Pi use needs only compile before actual work;
10. active architecture is understandable from one short document;
11. retained tests/smokes pass;
12. no replacement framework was introduced.

Final experience:

`give Charter a task → determine bounded truth → ambiguity stops → valid task compiles → state what is truly enforced → Pi works`

> **Charter protects the work. The builder does not serve Charter.**
