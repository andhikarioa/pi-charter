---
name: pi-charter
description: Compile explicit bounded authority, model routing, execution-target truth, role instructions, and fail-closed next actions for non-trivial Pi work. Use when work needs explicit scope, authority, permissions, verification, review/correction boundaries, adjudication, bounded escalation limits, parent/subagents execution governance, or delegated child work. State the intent and call charter_compile first — no source archaeology, no hand-authored contract; then read the result's four truths (authority, handoff, runtime attestation, execution proof) truthfully.
---

# pi-charter — operator guide

`pi-charter` is a deterministic, fail-closed **governance compiler**. It turns explicit authority
into governed truth:

```text
TaskContract
     ↓  validate (fail-closed)
     ↓  resolve → ExecutionContract (model, jurisdiction, narrowed scope/permissions)
     ↓  bind to execution target → real enforcement truth
     ↓  compile → RoleEnvelope (what this role may and must never do)
     ↓  executor acts — outside Charter
     ↓  explicit outcome + evidence
     ↓  Charter may decide one bounded next action
```

**Charter decides, constrains, and compiles. The execution substrate executes.**
Charter never spawns, supervises, retries, schedules, or recovers work, and holds no worker,
session, queue, or lifecycle state. It is not an orchestrator, scheduler, or workflow runtime.

## Normal path — tool first, archaeology OFF by default

From Pi, ordinary work needs no Charter knowledge at all. The whole flow is:

```text
1. parse the operator's intent
2. call charter_compile immediately, stating the intent directly
3. consume the handoff or the refusal
4. continue
```

One call, and only the fields the operator actually knows:

```yaml
task: implement JSON persistence
role: implement
target: subagents
authority: CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md    # a document path relative to root
scope: [internal/store/**]
fresh: required
gates: [go test ./internal/store/..., go vet ./internal/store/...]
```

Charter fills the deterministic fields core requires, resolves the authority document's content
identity itself, and refuses — with a remedy — anything it cannot establish. A normal request needs
**no** canonical `TaskContract` JSON, no binder object, no model profile, no capability envelope, and
no knowledge of Charter's internals.

```text
ARCHAEOLOGY: OFF by default

NO Charter source reads before the first compile
NO dist/ or .d.ts inspection to find out how to call the tool
NO Pi config grep
NO implementation archaeology
NO reference-chain traversal
NO hand-authored TaskContract JSON for normal work
```

A reference may be opened only **after an explicit blocker** — the tool output itself is insufficient
or contradicts what you were told — and then at most one, escalated only by the ladder below.
Convenience is not a blocker. Curiosity is not a blocker.

### Read the result as four separate truths

```text
Authority        BOUND | <refusal>        the bounded authority was compiled
Handoff          READY | <refusal>        bounded delegation parameters exist
Runtime attested YES | NO               did THIS process observe the runtime that runs the work?
Execution proof  AVAILABLE | UNAVAILABLE did trusted execution evidence exist at all?
```

For every `execution_target=parent` compile: authority is `BOUND`, the artifact set is admitted, and
execution proof arrives only when this session actually runs the work and reports the observation
through `charter_verify_execution`. Admission is not execution.

For every `execution_target=subagents` compile: authority is `BOUND`, the handoff is `READY`, runtime
attestation is `NO`, and execution proof is `UNAVAILABLE` — this process does not observe the child.
That is the truthful result, not a failure, and it is never a reason to refuse the delegation or to
claim the stronger thing:

```text
Authority       BOUND
Handoff         HANDOFF_READY
Runtime proof   UNAVAILABLE
Execution proof UNAVAILABLE

routing         REQUIREMENT_ONLY   the tier is what the substrate must resolve, never proof of
                                   which model the child ran
fresh           REQUIRED | NOT_REQUIRED   a dispatch requirement, never an observation
capability      unattested_claim   nothing about the child was observed, so nothing is ENFORCED
```

A delegation compile mints **no execution handle**, because a child this session cannot observe is
never admitted for execution here: `charter_verify_execution` applies to the parent session only.

## Surfaces

pi-charter ships as a **compiled package** (`dist/` JavaScript plus declarations, one exported entry
point) with a bundled **Pi extension**. From Pi, the supported surface is the two tools the extension
registers — nothing handwritten, nothing temporary:

```text
charter_compile           compile bounded governance for the active session, or bounded delegation
                          authority for target=subagents; admits parent artifacts for execution
charter_verify_execution  verify an OBSERVED run of this session against that admission, using that
                          handle; Pi's tool-execution event is the execution observation
```

`charter_compile` accepts either the simple intent above or, for advanced use, a full canonical
`task_contract` together with the exact `authority_evidence { source, doc, revision? }` its
`authority.sources` reference binds to. The sealed v0.1.1 spelling of that evidence — an `authority`
object beside `task_contract` — is still accepted as a compatibility alias. Neither tool accepts capability booleans, a model inventory, a
trust boundary, a model pin, or a caller-chosen compiler identity: those are derived from the live
session or refused. There is no CLI and no `/charter` command; the tools are the Pi-native interface.

Two supported library ways to invoke core:

```text
compileForTarget          the one blessed facade — use it from a host integration
compileDelegation         bounded delegation authority for target=subagents (handoff only, no
                          runtime attestation, no execution handle)
compileViaPi / observeExecutionViaPi / verifyExecutionViaPi
                          the library bridge — use it from TypeScript inside Pi; it derives the
                          environment evidence itself and mediates the active parent session only
```

Low-level functions (`resolveExecutionContract`, `bindExecutionTarget`,
`compileBoundRoleEnvelope`, …) remain public for advanced and internal use. Do **not** compose them
by hand when the facade covers the need, and never feed a target handoff into envelope compilation.
Adapters integrating their own runtime use the supported `createAdapterIntegration` contract; they
supply observations, and those observations are CANDIDATES from the ordinary package position — no
attested capability, no attested model, no issued execution evidence. Only the host-authorized
adapter context (the Pi bridge and the installed extension, which hold an in-process capability that
is not on the package surface) has observations promoted into trusted evidence.

## When to use Charter

Use it when governance must be explicit and hard, i.e. non-trivial work such as:

- bounded code implementation with declared files/symbols/permissions
- independent or fresh-session review
- correction against named, already-accepted findings
- bounded semantic/authority/contract adjudication
- intentionally delegated parent/subagents execution
- work requiring hard enforcement truth (tool ceiling, file scope, model selection)
- work with bounded escalation/correction limits

Do **not** force Charter ceremony onto:

- simple factual Q&A
- tiny wording edits
- casual discussion or exploration
- tasks with no meaningful execution authority

## Roles — five, and only five

`planner` — decompose already-admitted work into bounded, independently verifiable units.
Not for inventing product strategy, redesigning architecture, or implementing.

`implement` — one bounded implementation task whose semantics/architecture are already frozen.
Not for reopening architecture or unrelated refactoring.

`review` — bounded read-only conformance review. A clean PASS is a valid result.
Not for implementing fixes, and not a broad audit.

`correct` — apply only named accepted findings from a prior review/adjudication result.
With no named accepted finding there is nothing to correct: do not construct a `correct` run.

`adjudicate` — resolve one bounded semantic, authority, or contract contradiction.
Not implementation, and not general architecture ownership.

Role is a governance role, not a permission, and not a model. **Model selection belongs to core
routing — never choose a model in the skill, the prompt, or the plan.**

## Execution targets — exactly two

`parent` — the current parent Pi session executes the resolved contract directly. First-class;
subagents and intercom are not required.

`subagents` — execution is intentionally delegated to the subagents substrate. Charter compiles the
bounded authority and translates resolved truth into bounded handoff parameters (role, root, scope,
permissions, resolved model identity, routing requirement, fresh-context requirement, acceptance
commands, authority identity, enforcement truth, contract); **Charter does not spawn, track, retry, or
supervise the child, and does not attest the child runtime.**

Delegation is compiled by `compileDelegation` (or by `charter_compile` with `target: subagents`). It
returns `HANDOFF_READY` plus the truthful weaker evidence — `runtime_attested: false`,
`execution_proof: 'UNAVAILABLE'`, `routing.truth: 'REQUIREMENT_ONLY'`, and capability evidence that is
an unattested claim with no observed axis. Nothing about the child is `ENFORCED`, the resolved model
is a routing requirement rather than proof of what the child ran, and no execution handle is minted:
this process never admits a runtime it cannot observe. A requirement the target's capability cannot
be proven to satisfy — a fresh-session review, for instance — is still refused by canonical Phase 3,
never softened.

Target is not capability. Capabilities come from environment **evidence**, never from a target name
or a caller-supplied boolean: a raw `capability_claim` is recorded as an unattested claim and can
never produce `ENFORCED`. Each declared constraint resolves to exactly one of `ENFORCED` (trusted,
attested capability plus an applicable canonical policy), `INSTRUCTED` (a policy applies but nothing
attests hard enforcement), `UNSUPPORTED` (no instruction substitutes for the missing primitive), or
`NOT_APPLICABLE` (this contract declares no policy for that dimension). Never claim a capability
merely because a target was selected.

`pi-intercom` is **optional** and external to Charter core. Use it only when communication between
existing sessions genuinely helps. It is not part of the Charter execution pipeline.

## Evidence truth in v0.1.2

```text
claim              ≠ attestation           a source name, a version string, and a boundary-shaped
                                            record establish nothing without the exact boundary that
                                            issued the candidate
authority BOUND    ≠ runtime attested      the bounded authority compiled; the child runtime was
                                            never observed by this process
Handoff READY      ≠ child execution       delegation parameters exist; nothing ran under them yet
routing            REQUIREMENT_ONLY        the tier the substrate must resolve — never proof of the
                                            model the child ran
fresh              a REQUIREMENT            a dispatch requirement, never an observation that a
                                            fresh session happened
ENFORCED           = trusted capability evidence + an applicable canonical policy
NOT_APPLICABLE     no policy for that dimension — nothing to enforce and nothing to instruct
assertion bound    ≠ assertion verified     only evidence that the exact bound verifier ran and
                                            passed moves a bound assertion to verified
command declared   ≠ acceptance verified    declared gates are declarations; verifier evidence is
                                            reported separately, and never inferred from them
ResolutionReceipt  ≠ ExecutionAttestation   a receipt proves what was COMPILED; a run is proven by
                                            trusted execution evidence
correct authority  requires accepted finding provenance — a bound authority source grounds a named
                   finding, it is never itself a finding
execution          conformance requires the exact artifact link: the admission handle returned when
                   governance was compiled, not artifacts supplied at verification time
```

## Fail-closed operator behavior

Never guess: authority, scope, model or fallback, execution target, hard enforcement, accepted
findings, or architecture authority.

If Charter refuses, **interpret the refusal** — do not rewrite the contract to make it pass, unless
the user/authority explicitly changes the task.

A refusal is a truth about the request, and the tool states it in a shape you can act on:

```text
REFUSED

Reason:
<CODE> @ <path>
<what failed>

Retry:
YES, after <the minimal action> | NO, <why it is not retryable>

Remedy:
<the minimal operator action that resolves it>
```

```text
AUTHORITY_UNRESOLVED               → obtain explicit authority; do not pick the closest file
MODEL_UNAVAILABLE                  → use only a declared fallback; otherwise stop
UNSUPPORTED_BY_EXECUTION_TARGET    → instruction-level is not hard enforcement; do not pretend
CONTRACT_CONTRADICTION             → resolve the contradiction explicitly
HUMAN_DECISION_REQUIRED            → stop autonomous progression
```

Full meaning, inspection point, and forbidden guesses for every canonical code:
`references/refusals-and-next-actions.md`. The tool renders each refusal as **what failed**, whether
**retrying is meaningful**, and the **minimal remedy** — a refusal is a truth about the request, not a
puzzle, and its remedy never asks for more authority than the request already needed.

## TODO-first convention

For non-trivial execution, before any read, search, command, or edit, create a bounded,
dependency-aware TODO list (max ~7 items) and keep its states current. This is an **instruction
convention only** — Charter holds no TODO persistence and no workflow state.

## Archaeology and research

```text
ARCHAEOLOGY: OFF by default
RESEARCH: explicit permission only
```

If authority is insufficient for the work: **STOP** and say so. Do not widen the search merely
because more context would be convenient.

## Read discipline — the tool first, references second

Normal operation never needs this section: the tool compiles from stated intent, and its output says
what was established. This section governs the only remaining reason to read anything — **interpreting
a result, explaining a boundary, or resolving a blocker the tool output itself could not settle**. The
path is:

```text
charter_compile (tool)          ← authoring happens here, not in these references
     ↓
SKILL.md                        ← only when the result needs interpretation
     ↓
minimum relevant reference(s)   ← only on a concrete blocker
     ↓
interpret / explain / guide
     ↓
STOP
```

1. Call the tool first. It is the compile surface, and it is authoritative about what it established.
2. Read this `SKILL.md` when a result needs interpretation.
3. Read only the reference(s) matching the current blocker.
4. **STOP when the task can be answered truthfully.** Sufficient evidence is a stop condition.

Do not inspect core source merely to reconfirm facts this companion already answers — and never
before the first compile.

### Source escalation ladder

```text
LEVEL 0   SKILL.md
LEVEL 1   the relevant companion reference(s)
LEVEL 2   src/index.ts — only when the installed public API identity/signature must be verified
LEVEL 3   one exact defining core file — only when a specific contradiction remains unresolved
STOP
```

Escalate only on an actual evidence gap — and only **after** the tool has already been called:

```text
the tool refused and its remedy does not resolve the blocker
a required fact is absent from the references
two companion references materially contradict each other
runtime/package truth contradicts the references
the user explicitly asks for source-level verification or audit
```

Convenience is not a reason. Curiosity is not a reason. Wanting extra confidence is not a reason.

Not part of ordinary adoption: repository-wide `find`/`grep`, canonical-spec archaeology, or reading
all contract/resolver/enforcement modules "to be safe".

Discouraged when a companion reference already provides sufficient truth:

```text
"I'll read the implementation to be safe."
"I'll inspect all related files."
"I'll grep the spec for confirmation."
"I'll check how this works internally."
```

**Precedence is unchanged.** References are the default operational interface; core is the higher
authority. When they genuinely conflict, core wins and the reference is corrected — but the conflict
must be evidenced, never assumed.

## Progressive disclosure — need → reference

| Need | Read |
|------|------|
| Invoke the library correctly (facade first, Pi integration, delegation, adapter contract, evidence rules) | `references/library-usage.md` |
| Author a canonical TaskContract (advanced path only — the tool does this normally) | `references/contract-authoring.md` |
| Choose/understand role or target | `references/roles-and-targets.md` |
| Interpret refusal / next action | `references/refusals-and-next-actions.md` |
| See complete bounded examples | `references/worked-examples.md` |

If the reference already answers the question, **do not continue into `src/**`** — the escalation
ladder above governs.

## Do not duplicate core policy

Charter core owns, and this skill must never restate as its own decision procedure:

```text
model fallback algorithm · monotonic narrowing · enforcement truth evaluation
scope subset logic · authority binding · escalation counters · receipt hashing
target capability validation · execution-attestation conformance
```

Use the pi-charter core result as truth. The skill may explain what a result means; it may not
re-derive it, and it may not decide a governance question Charter is built to decide.
