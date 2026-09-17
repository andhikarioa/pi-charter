# PI CHARTER — LEAN ARCHITECTURE / SEMANTIC COMPRESSION AUDIT

Status: **AUDIT COMPLETE — READ-ONLY FINDINGS DOCUMENTED**  
Implementation authorization: **NONE**  
Repository role: **Current implementation truth**  
Audit purpose: **Preserve governance guarantees while reducing semantic/formal machinery, operator ceremony, and solo-maintainer burden.**

---

## 1. Executive verdict

Pi Charter's core thesis is strong:

> **Pi Charter is a governance compiler, not an execution runtime.**

That boundary is materially healthier than Mandor's former execution/control-plane ownership. The current problem is different: **over-formalized governance machinery around a conceptually small protected core**.

The repo is not a rewrite candidate. It is a **semantic compression candidate**.

The desired target remains:

```text
TASK
  ↓
AUTHORITY + SCOPE
  ↓
CAPABILITY TRUTH
  ↓
COMPILE
  ↓
MINIMAL RECEIPT
```

The main slimming opportunities are:

- duplicated validation and binding work,
- too many canonical/intermediate governance artifacts,
- receipt machinery that partially recompiles/revalidates the task,
- public low-level proof boundaries that force extra anti-forgery machinery,
- lifecycle-adjacent execution admission/verification state,
- escalation/adjudication machinery outside the minimum compiler thesis,
- formal taxonomies that currently have little or no behavioral effect,
- documentation and release ceremony larger than a private one-builder tool needs.

The goal is **not** fewer lines for their own sake. The goal is:

> **Truthful, bounded, deterministic, simple, low-friction, and boring enough to maintain for years.**

---

## 2. Repository binding / verified current truth

Audit repository:

```text
HEAD:    9f560ad453f52938e8179d21f2df9f4e8134e33c
Tag:     v0.1.2
Version: 0.1.2
```

Observed repository state:

- latest tag `v0.1.2` targets current HEAD exactly,
- package version is `0.1.2`,
- working tree was clean at audit start,
- visible history contains 20 commits,
- all 20 visible commits have the same author identity,
- runtime dependencies: **0**,
- development dependencies: TypeScript + `@types/node`,
- package exposes one root export path but a very large named SDK surface,
- Pi tool surface includes:
  - `charter_compile`
  - `charter_verify_execution`

Fresh verification performed during audit:

```text
npm test / Node test suite:       PASS — 308/308
TypeScript typecheck:             PASS
Compiler tamper smoke:            PASS
External consumer/package smoke:  PASS
Pi-native smoke:                  NOT RUNNABLE IN AUDIT SANDBOX
```

Pi-native smoke was environment-unavailable because the Pi package/runtime was not installed in the audit sandbox. This was not treated as a Charter failure.

Package dry-run showed approximately:

```text
70 files
~165 KB compressed
~630 KB unpacked
```

---

## 3. Corrected size / maintenance-surface measurements

The earlier external claim of roughly `18.8k lines code` is directionally plausible only when production and test/support code are combined.

Observed physical LOC:

| Surface | LOC |
|---|---:|
| Runtime `src/` excluding tests + fixture | **8,564** |
| Pi extension | **534** |
| Runtime + extension | **9,098** |
| Build/smoke scripts | 731 |
| Tests | 9,574 |
| Shared test fixture | 710 |
| Tests + fixture | **10,284** |
| All Markdown | **4,437** |
| Markdown nonblank | 3,303 |
| Canonical master spec | **2,303** |

Important interpretation:

> **The test/proof support surface is larger than the runtime implementation.**

This is not a runtime-performance problem. The test suite is fast. It is a **maintenance and cognitive-load problem**.

The visible git-history window from first visible commit to current HEAD is approximately 31h46m, but the first visible commit is already a substantial baseline. Therefore the history does **not** prove the entire product was built in only ~32 hours.

---

## 4. Scorecard

Higher is better. For operator ceremony, higher means less unnecessary ceremony.

```text
Core thesis quality:              9.5/10
Architecture simplicity:          4.5/10
Complexity justification:         5.5/10
Intent fidelity:                  9.0/10
Determinism:                      9.5/10
Ergonomics:                       6.5/10
Solo-builder maintainability:     4.5/10
Operator ceremony:                6.0/10
Confidence:                       9.0/10
```

Confidence is below 10 because Pi-native smoke could not be executed in the audit sandbox, although its source contract and integration code were inspected and all other local verification surfaces passed.

---

## 5. Golden compile path — current implementation

Desired conceptual path:

```text
task input
→ normalize
→ validate authority + scope
→ resolve model + target + capability
→ classify enforcement truth
→ compile bounded instruction
→ minimal receipt
```

Observed current path is materially richer:

```text
operator intent
  ↓
normalizeOperatorRequest
  ↓
TaskContract
  ↓
validate
  ↓
resolve
  ↓
ExecutionContract
  ↓
bind target
  ↓
TargetBinding
  ↓
compile RoleEnvelope
  ↓
re-bind target through adapter
  ↓
TargetHandoff
  ↓
receipt:
    validate again
    resolve again
      validate again
    bind again
  ↓
ResolutionReceipt
  ↓
[parent path]
execution admission handle
  ↓
later execution observation
  ↓
charter_verify_execution
```

### Key finding: repeated establishment of the same truth

A normal facade compile performs repeated validation/binding work. In the observed path, approximately:

```text
TaskContract validation   ×3
Target binding            ×3
authority binder lookup   ×5 per authority reference
```

This is not primarily a speed issue. It is a semantic ownership issue.

The receipt currently behaves partly like a **second compiler proving the first compiler**. This duplication is largely enabled by the fact that low-level phases are public, caller-visible APIs and therefore defend against synthetic intermediate artifacts.

High-leverage conclusion:

> **Narrowing the supported public boundary can remove significant defensive proof machinery without weakening protected behavior.**

---

## 6. Responsibility map

| Subsystem | Classification | Invariant defended | Audit direction |
|---|---|---|---|
| `TaskContract` | CORE INVARIANT | explicit role/task/scope/authority/permissions | KEEP |
| structural + semantic validation | CORE / deterministic mechanic | malformed/contradictory input fails closed | KEEP, COMPRESS |
| authority/evidence binding | CORE INVARIANT | authority cannot be invented or ambiguous | KEEP |
| evidence digest/provenance | NECESSARY MECHANIC | exact bound authority content identity | KEEP, simplify terminology if possible |
| scope validation | CORE INVARIANT | no silent widening / root escape | KEEP |
| model resolution | CORE INVARIANT | no silent substitution | KEEP |
| target enforcement truth | CORE INVARIANT | ENFORCED != INSTRUCTED | STRONGLY KEEP |
| `Jurisdiction` object | DUPLICATED / FORMALIZED | role/permission narrowing | COLLAPSE |
| generic attestation/verifier boundaries | USEFUL BUT OVERBUILT | caller cannot self-promote claims | COLLAPSE around real observations |
| `ExecutionContract` | NECESSARY CANONICAL ARTIFACT | resolved bounded truth | KEEP |
| `RoleEnvelope` | CORE concept, duplicated artifact | bounded instruction | KEEP CONCEPT, COLLAPSE REPRESENTATION |
| parent/subagents adapters | NECESSARY translation | target-specific handoff | KEEP behavior, remove repeated binding |
| `ResolutionReceipt` | CORE minimal evidence, current implementation duplicated | compile identity / reconstruct truth | THIN RADICALLY |
| bounded escalation policy | USEFUL BUT OPTIONAL | deterministic post-run next action | DELETION CANDIDATE |
| execution admission + attestation | OPTIONAL / BOUNDARY CREEP | link later parent work to admitted artifact | STRONG DELETION/COLLAPSE CANDIDATE |
| compiler artifact identity | USEFUL BUT OPTIONAL | stale/tampered build detection | RETAIN ONLY IF THREAT MODEL JUSTIFIES |
| operator normalization | NECESSARY ERGONOMIC LAYER | simple user intent → canonical request | KEEP, simplify |
| delegation compiler | NECESSARY MECHANIC | truthful child handoff | KEEP |
| broad named SDK surface | FUTURE-PROOFING / LIABILITY | programmatic access to internal phases | SHRINK HARD |
| master build spec | HISTORICAL / PROCESS HEAVY | build-era authority | ARCHIVE AS HISTORY, not daily mental model |
| proof/conformance scaffolding | CURRENTLY USEFUL, architecture-coupled | protect existing trust boundaries | SHRINK WITH REMOVED MACHINERY |

---

## 7. Protected core — must remain

The following behaviors define Pi Charter and should be treated as non-negotiable unless fresh evidence proves otherwise:

1. A task has explicit bounded role and intent.
2. Authority cannot be invented.
3. Missing or ambiguous authority fails closed.
4. Bound authority content has a stable identity/provenance.
5. Scope cannot silently widen.
6. Scope/root escape fails closed.
7. Writing requires bounded scope.
8. Read-only roles cannot silently mutate.
9. Mutation permissions are explicit.
10. Model resolution cannot silently substitute an unavailable model.
11. Target/runtime capability truth is explicit.
12. `ENFORCED`, `INSTRUCTED`, `UNSUPPORTED`, and `NOT_APPLICABLE` remain distinct.
13. Hard requirements fail when the target cannot truthfully provide them.
14. Unknown governance-bearing fields fail closed.
15. Compiled instruction preserves canonical authority/scope/role/permissions.
16. Subagent handoff never invents child execution proof.
17. Fresh-session review must not be represented as external independence.
18. Minimal deterministic evidence remains sufficient for debugging/reconstruction.
19. Charter must not own an execution runtime/control plane.

These are the acceptance anchors for slimming.

---

## 8. Authority + scope audit

This is one of the healthiest areas of the implementation.

Observed useful guarantees include:

- missing/unreadable authority file fails,
- directory-as-authority fails,
- absolute paths fail,
- lexical root escape fails,
- real filesystem containment is checked,
- symlink-based authority escape can be rejected,
- exactly one authority binding is required where ambiguity would otherwise exist,
- evidence provenance binds a reference to a concrete digest/content identity.

These are real safety properties and should not be weakened for line-count reduction.

### Compression opportunity

Authority is currently checked repeatedly across validation/resolution/provenance work.

Preferred semantic ownership:

```text
schema/shape validation
        ↓
bind authority exactly once
        ↓
canonical resolved provenance
        ↓
all later phases consume that object
```

This is both simpler and more truthful than calling a binder multiple times and expecting all calls to return equivalent answers.

---

## 9. Enforcement truth audit

Current enforcement vocabulary:

```text
ENFORCED
INSTRUCTED
UNSUPPORTED
NOT_APPLICABLE
```

Recommendation: **keep all four**.

They represent materially different truths:

```text
NOT_APPLICABLE
= no policy exists for this axis

INSTRUCTED
= policy exists, but only prompt/instruction-level restriction is available

ENFORCED
= trusted runtime primitive is actually observed/attested

UNSUPPORTED
= required guarantee cannot truthfully be supplied by the target/runtime
```

This epistemic distinction is one of Charter's strongest reasons to exist.

### Important current Pi truth

The bundled first-party Pi integration observes environment information but does not currently provide the stronger capability-observation surface used to attest enforcement axes.

Therefore the common first-party Pi path does not magically promote file/tool/model restrictions to `ENFORCED` without real runtime proof.

That is correct behavior.

However, it raises a proportionality question:

> **Can the same honesty be implemented with less generic attestation/verifier machinery?**

Likely yes.

Protected rule should be simple:

```text
explicit trusted runtime observation → ENFORCED
policy only                          → INSTRUCTED
runtime cannot supply requirement   → UNSUPPORTED
no policy                            → NOT_APPLICABLE
```

Keep the truth. Challenge the abstraction count.

---

## 10. Review independence semantics

The implementation already distinguishes fresh-session behavior from stronger independent-review claims better than some surrounding prose does.

Required distinctions:

### Session independence

```text
fresh session/context
```

Real and useful.

### Process/model independence

```text
separate invocation/model/role
```

Potentially stronger, but still not equivalent to external audit.

### External independence

```text
separate human / organization / toolchain
```

Not automatically provided by Charter.

### Operator approval

```text
user accepts / decides
```

Should be named plainly where that is what actually happened.

Recommended lean wording:

```text
reviewed_by = fresh_session
approved_by = user
enforcement = instructed
```

Reserve terms such as `independent review` or `attested independence` for cases where stronger evidence really exists.

Avoid language that makes a fresh child LLM sound like an external auditor.

---

## 11. Receipt / evidence audit

Current receipt carries a rich set of fields, including contract/compiler identities, authority provenance, model evidence, capability evidence, jurisdiction/permissions copies, validation/resolution outcomes, and a receipt identity.

Observed problem:

> **The receipt partly recomputes and revalidates truth that the compiler has already established.**

The receipt should not become a second governance universe.

### Design choice that should be made explicitly

Choose one model:

#### A. Compact receipt pointing to canonical resolved truth

Preferred for this project.

```text
canonical resolved contract = source of truth
receipt = compact projection/identity/debug summary
```

or:

#### B. Full standalone snapshot

More duplication, justified only if independent offline reconstruction is genuinely required.

Current implementation partially does both.

### Strong simplification target

Delete receipt-side recompilation/revalidation/rebinding.

Then challenge fields that are merely duplicated copies and have no active production consumer.

A plausible lean receipt is conceptually:

```json
{
  "task_id": "...",
  "role": "review",
  "compiler": "...",
  "contract_identity": "...",
  "authority": [
    {"reference": "PLAN.md", "digest": "..."}
  ],
  "target": "subagents",
  "model": "...",
  "enforcement": {"...": "INSTRUCTED"},
  "receipt_identity": "..."
}
```

Illustrative only; fresh implementation planning should determine exact minimal fields.

---

## 12. Validation/compiler layering audit

Current conceptual artifact stack includes roughly:

```text
TaskContract
ExecutionContract
TargetBinding
RoleEnvelope
TargetHandoff
ResolutionReceipt
ExecutionAdmission
ExecutionAttestation
```

This is a large semantic vocabulary relative to the product's irreducible responsibility.

A better ownership model is closer to:

```text
Request
  ↓
ResolvedTask / ExecutionContract  ← single canonical governance truth
  ↓
Instruction
  ↓
Target-specific handoff
  ↓
Minimal receipt
```

### RoleEnvelope

Bounded instruction compilation is necessary.

But `RoleEnvelope` currently duplicates a large amount of resolved governance truth. Challenge whether it must be another rich canonical object rather than a projection/instruction representation derived from one canonical contract.

### Jurisdiction

Much of `Jurisdiction` is fixed or directly derived from role + permissions, for example concepts equivalent to:

```text
scope = bounded
architecture = none
search = bounded
archaeology = false
mutation.repository = role/permission-derived
```

These may be useful instructions but do not necessarily deserve first-class replicated state.

High-value candidate:

> **Keep the invariant, delete the noun.**

Compile the prohibitions directly from canonical role/scope/permissions.

---

## 13. Public API / proof-boundary audit

Although the package exposes only one root subpath, the root SDK exposes approximately **213 named symbols**.

This includes low-level binders, resolvers, target binding APIs, receipt constructors, verifier/attestation types, envelope compilers, and many intermediate constants/enums/types.

This has a major hidden maintenance cost:

> **Every public intermediate phase becomes a caller-controlled compatibility boundary.**

That forces the repo to defend against synthetic/intermediate objects, forged trust claims, copied bindings, and other cases that would disappear if those types/functions were internal implementation detail.

For a private one-operator governance compiler, a much smaller supported API is likely sufficient:

```text
compile(...)
```

plus a limited set of input/output types and truly useful inspection helpers.

Internal modules can remain unit-testable without becoming permanent public compatibility commitments.

Shrinking the public surface is likely one of the highest-leverage maintainability improvements because it also removes the need for some downstream anti-forgery/proof machinery.

---

## 14. Strong deletion candidate #1 — post-execution admission / verification

The parent execution path currently introduces lifecycle-adjacent state:

```text
compile
→ mint execution_handle
→ store process-local admission
→ store pending handle/session state
→ observe later tool execution
→ mark as executed
→ charter_verify_execution(handle)
→ produce execution attestation/result
```

This is not Mandor-scale runtime ownership, but it is the point where Charter begins moving away from a pure compiler.

Observed state includes bounded in-memory admission/pending maps and opaque execution handles.

### What current proof actually establishes

The Pi extension observes a later non-Charter tool execution in the parent session and can compare things such as artifact/session/model identity.

It does not, on the common path, automatically prove all of:

- exact file operations stayed in scope,
- tool ceilings were hard-enforced,
- acceptance commands passed,
- all requested enforcement axes were active,
- all verification semantics succeeded.

Therefore an outcome with broad wording such as `EXECUTION_CONFORMANT` can be stronger-sounding than the evidence actually warrants.

This subsystem protects a real but narrow guarantee:

> **Some later parent-session work was observed after admission, and selected artifact/session/model identities agree.**

Audit question:

> Is that guarantee valuable enough to justify the extra state, second Pi tool, vocabulary, and maintenance surface?

Current audit answer:

> **Probably not for the minimum Charter thesis. Strong deletion candidate.**

If retained, outcome wording should be narrowed to exactly what was observed.

Potential deletion scope if future implementation review confirms no required consumer:

```text
ExecutionAdmission
ExecutionAttestation
execution admission handle
process-local admission/pending maps
observeExecution lifecycle state
verifyExecution machinery
charter_verify_execution tool
Pi execution observation bridge
```

Do not remove before a bounded implementation plan proves all affected invariants/consumers.

---

## 15. Strong deletion candidate #2 — escalation / adjudication policy

The deterministic post-run next-action subsystem includes concepts such as:

- execution outcomes,
- correction rounds,
- semantic escalation rounds,
- adjudication routing,
- limits/counters,
- terminal policy/de-escalation.

It is substantial code/test surface and is not part of the active Pi integration's core compile path.

It protects this concrete behavior:

> map a supplied post-run outcome + counters to a deterministic suggested next action.

Useful, but not central to:

```text
intent
+ authority
+ scope
+ capability truth
+ bounded instruction
+ minimal evidence
```

Audit direction:

> **Delete unless a real current consumer proves this belongs in Charter.**

Removing it may also allow removal of downstream limits/terminal/adjudication concepts that currently propagate through canonical artifacts only because the subsystem exists.

---

## 16. Low-ROI taxonomy candidates

These are challenge candidates, not automatically authorized deletions.

### Task class + risk

Current routing behavior is primarily role-driven. Task class/risk have little current effect, with limited special-case semantics.

The simple operator path can inject fixed/default values without meaningful user choice.

This is a warning sign that taxonomy may be ahead of behavior.

### Verification levels `V0–V5`

The current simple path uses a fixed verification level while explicit gate command strings carry the actual actionable verification semantics.

If the level does not select meaningful behavior, challenge whether taxonomy alone earns its permanent maintenance cost.

### Structured release/external actions

These can help detect permission contradictions, but if equivalent truth is already represented by explicit release/external-write permissions plus bounded instructions, the extra action taxonomy should prove why it remains necessary.

General rule:

> A taxonomy must alter a real decision or guarantee, not merely make the model more formally complete.

---

## 17. Ergonomics audit

Current v0.1.2 common input path is reasonably compact, with concepts equivalent to:

```text
task
role
target
authority
scope
fresh
gates
```

Strengths:

- defaults are predictable,
- errors are generally actionable,
- filesystem authority binding is automated,
- subagent handoff does not fabricate execution proof,
- capability truth remains explicit.

Main remaining ergonomic costs:

### Parent path

Current parent workflow can become:

```text
charter_compile
→ perform work
→ charter_verify_execution
```

Given the limited additional proof supplied by the second step, this is the strongest daily-ceremony concern.

### Operator-visible vocabulary

Concepts such as separate authority truth, handoff truth, runtime attestation, execution proof, jurisdiction, adjudication, etc. can be technically distinct while still being hidden from the common operator path.

Ideal common output should be closer to:

```text
ALLOWED
scope: ...
authority: ...
target: ...
runtime enforcement: instruction only
```

or:

```text
BLOCKED
reason: authority is ambiguous
```

The common workflow should not feel like operating a governance platform.

---

## 18. Maintainability audit

Current core thesis is easy to explain.

Current implementation is not comparably easy to reacquire.

A maintainer changing proof/target/receipt semantics may need to understand interactions among:

```text
validation
resolution
provenance
attestation boundary
target binding
canonical binding provenance
role envelope
receipt
adapter integration
execution attestation
operator surface
Pi extension
```

Warning signals:

- ~213 public named exports,
- 8.5k+ runtime source LOC for a conceptually small compiler,
- 10.2k+ test/support LOC,
- large conformance/proof-boundary test surfaces,
- a 2,303-line canonical master spec,
- multiple representations of the same governance state,
- process-local trust/proof objects,
- lifecycle-adjacent execution state,
- formal enums with little current behavioral effect.

Current answer to the longevity test:

> **A solo builder returning after three months would likely need meaningful archaeology before safely changing target capability, receipts, review semantics, or execution evidence.**

That is too expensive for the intended product.

---

## 19. Top deletion candidates

Ordered by architectural ROI, subject to bounded implementation review:

1. **Post-execution admission / attestation / verification subsystem**
   - stateful lifecycle-adjacent machinery,
   - second Pi governance operation,
   - narrow evidence value relative to operator interpretation risk.

2. **Bounded escalation / next-action subsystem**
   - outside minimum compiler thesis,
   - no active Pi core-path consumer found,
   - introduces outcomes/counters/limits/adjudication vocabulary.

3. **Verification level taxonomy where it does not select behavior**
   - explicit gates provide stronger real semantics.

4. **Task class/risk dimensions where they do not alter current routing/guarantees**
   - challenge formal taxonomy without behavioral consequence.

5. **Limits/terminal/adjudication concepts whose only purpose disappears with escalation removal.**

6. **Packaged test-only fixture/build residue**
   - small hygiene cleanup, not architectural priority.

---

## 20. Top collapse candidates

### 20.1 Validation + authority resolution

Current repeated checking should converge toward:

```text
parse/schema
→ bind authority once
→ semantic contradiction checks
→ canonical resolved task
```

### 20.2 Target binding + target adapters

Bind target/capability once, then project that exact truth into parent/subagent handoff.

### 20.3 Receipt

Change from:

```text
second compiler / proof pass
```

into:

```text
small projection/hash of canonical compile result
```

### 20.4 Jurisdiction

Derive instructions directly from role + permissions + scope instead of maintaining a replicated first-class governance object where it adds no independent truth.

### 20.5 RoleEnvelope

Keep bounded instruction semantics; stop cloning the whole governance model into another rich artifact.

### 20.6 Attestation architecture

Retain the distinction between:

```text
observed
claimed
not observable
```

without preserving every current generic verifier/attestation abstraction if fewer concepts provide the same fail-closed honesty.

### 20.7 Public SDK

Shrink toward one blessed compiler facade plus a small set of stable input/output types.

This can remove substantial defensive complexity downstream.

---

## 21. Terminology simplification candidates

| Current/formal concept | Leaner wording |
|---|---|
| independent review | `fresh-session review` unless stronger independence is observed |
| independent reviewer | `fresh reviewer session` |
| external independence implication | explicitly unsupported unless externally proven |
| attestation | reserve for runtime-issued evidence; otherwise `observation` / `claim` |
| owner adjudication | `user decision` where that is what actually happened |
| semantic adjudication | `resolve named contradiction` if retained |
| jurisdiction | often `scope + permissions` |
| ResolutionReceipt | `compile receipt` |
| sealed/immutable release | `tagged release` |
| EXECUTION_CONFORMANT | if retained, narrow to the exact observed identity/session/model proof |

General principle:

> **Formal language must correspond to a stronger real guarantee. Otherwise prefer plain words.**

---

## 22. Receipt simplification candidates

Challenge first:

```text
validation_result
resolution_result
```

A receipt only exists after successful compile; these can be tautological.

Then challenge duplicated copies such as:

```text
task_contract_identity
model_profile_identity
resolved_role
resolved_jurisdiction
resolved_permissions
```

where the canonical contract already carries the same truth and no real consumer needs a standalone duplicate.

Also challenge duplicated evidence copies depending on whether the chosen receipt model is pointer/summary or standalone snapshot.

Highest-value change remains:

> **Remove receipt-side validation/resolution/binding recomputation.**

---

## 23. Release/process simplification

Future private release flow can likely be:

```text
typecheck
→ tests
→ pack/consumer smoke
→ Pi smoke when environment available
→ tag
→ push
→ short release record
```

Retain compiler-specific smoke only if the compiler artifact identity/threat model still justifies it after slimming.

Challenge future ceremony such as:

```text
seal language
immutable release language
long release authority records
multi-stage closeout prose
repeated review artifacts
```

unless a concrete invariant depends on it.

Historical release/build docs should remain as history. Do not rewrite old evidence just to make the repo look cleaner.

Desired active documentation set after slimming:

```text
README
ARCHITECTURE / INVARIANTS — roughly one page
short CHANGELOG / release record
```

The current 2,303-line build spec should not be required reading for ordinary maintenance.

---

## 24. Tests — what must remain protected

Slimming must preserve regression coverage for at least:

```text
ambiguous authority → REFUSE
missing authority → REFUSE
authority symlink/root escape → REFUSE

write role + empty scope → REFUSE
scope ../ escape → REFUSE
unrestricted wildcard without explicit override → REFUSE

review/planner/adjudication-style read-only roles cannot mutate repository
correction mutation stays within explicitly admitted correction target

unavailable model → explicit fallback or REFUSE
no silent model substitution

capability claim cannot become ENFORCED
INSTRUCTED never rendered as hard enforcement
unsupported hard requirement → REFUSE
no policy → NOT_APPLICABLE

subagent handoff never claims child execution
fresh session never becomes external independence

unknown governance-bearing field → REFUSE
```

Do **not** preserve zombie tests solely to protect machinery that is intentionally deleted.

The acceptance suite should protect observable invariants, not historical architecture.

---

## 25. Estimated reduction potential

Ranges, not fake precision:

```text
production implementation complexity     ↓ ~30–45%
test / maintenance surface               ↓ ~35–50%
documentation / process burden            ↓ ~55–70%
operator-visible concepts                 ↓ ~35–50%
conceptual / state-space complexity       ↓ ~40–55%
```

LOC reduction should be an outcome, not the KPI.

Primary KPIs should be:

```text
fewer canonical concepts
fewer public states
fewer repeated validations/bindings
fewer operator steps
fewer proof layers
same or better fail-closed behavior
same or better intent fidelity
same enforcement honesty
faster architecture reacquisition after time away
```

---

## 26. Recommended implementation structure

Do not create five ceremonial waves if three bounded waves are enough.

### PRECONDITION — compact invariant freeze

No product behavior change.

Freeze a small behavioral acceptance suite around:

- authority truth,
- scope truth,
- permission/role truth,
- model resolution truth,
- enforcement classification truth,
- bounded instruction fidelity,
- truthful subagent/fresh-session semantics.

This should be a short precondition, not another large documentation phase.

### WAVE 1 — Remove / decide non-core ownership

Primary questions:

- Does Charter keep or delete execution admission/verification?
- Does Charter keep or delete escalation/next-action machinery?
- Which concepts exist only because those systems exist?

Goal:

> remove state/lifecycle concepts outside the minimum compiler thesis before polishing the remaining architecture.

### WAVE 2 — Compress the compiler

Candidate work:

- bind authority once,
- bind target/capability once,
- receipt becomes projection rather than recompilation,
- collapse `Jurisdiction`,
- thin `RoleEnvelope`,
- reduce duplicate canonical representations,
- narrow supported public API,
- remove proof machinery no longer required by public intermediate phases.

Protected invariants must remain unchanged.

### WAVE 3 — Surface / docs / release cleanup

Candidate work:

- precise fresh-session vs independence vocabulary,
- thin active README/architecture docs,
- remove obsolete/zombie tests,
- simplify future release process,
- package/build hygiene,
- ensure common Pi usage exposes only the small public mental model.

No new feature work during these waves.

---

## 27. Desired final mental model

Architecture should be explainable in one page and ideally in one sentence:

> **Given a task, Pi Charter determines exactly what is authorized, where work may happen, what the selected runtime can actually enforce, and emits a bounded instruction without pretending unsupported guarantees exist.**

Desired internal conceptual flow:

```text
REQUEST
  ↓
resolve authority + scope once
  ↓
resolve model + target capability once
  ↓
canonical bounded truth
  ↓
compile instruction
  ↓
small receipt
```

Desired common operator experience:

```text
charter_compile(...)
→ ALLOWED / BLOCKED
→ truthful enforcement
→ bounded instruction
```

The tool should mostly disappear behind normal Pi usage.

---

## 28. What must NOT happen during slimming

Do not:

- rewrite from scratch,
- create `pi-charter-next`,
- invent a replacement governance framework,
- add a policy DSL,
- add scheduler/worker/runtime/recovery machinery,
- weaken fail-closed behavior,
- collapse `ENFORCED` and `INSTRUCTED`,
- pretend fresh LLM review is external audit,
- create a plugin/provider framework without real multiple implementations,
- add receipt richness,
- expand dogfood into a platform,
- optimize toward an arbitrary LOC target,
- preserve old abstractions merely because tests exist for them,
- perform broad archaeology unless a concrete authority contradiction requires it.

---

## 29. Definition of done for slimming

Pi Charter slimming is successful when:

- original governance intent is preserved,
- authority ambiguity still fails closed,
- scope expansion still fails closed,
- permission boundaries remain explicit,
- model/target resolution remains truthful,
- enforcement truth remains honest,
- bounded instruction fidelity stays equal or improves,
- common workflow needs fewer concepts and fewer steps,
- receipt/evidence remains sufficient for debugging,
- test loop remains trustworthy,
- no runtime/control-plane ownership is introduced,
- no new architecture replaces the old complexity,
- active docs become small enough to reacquire quickly,
- a solo builder can return after months away and safely understand/change the repo without spending a day on archaeology.

---

## 30. Final principle

The repo should not optimize for being impressive.

It should optimize for being owned.

Every mechanism must justify itself by protecting at least one of:

```text
intent
authority
scope
capability truth
bounded instruction
minimal useful evidence
```

If it protects none of those:

> **challenge it.**

If the same guarantee survives with fewer concepts:

> **collapse it.**

If it only adds formality:

> **delete it.**

The best Pi Charter is the smallest one that preserves the real guarantees—and remains boring enough that one builder can confidently maintain it for years.
