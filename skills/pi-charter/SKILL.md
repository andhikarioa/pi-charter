---
name: pi-charter
description: Compile explicit bounded authority, model routing, execution-target truth, role instructions, and fail-closed next actions for non-trivial Pi work. Use when work needs explicit scope, authority, permissions, verification, review/correction boundaries, adjudication, bounded escalation limits, or parent/subagents execution governance. Explains how to author a TaskContract and read Charter's governed results truthfully.
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

## v0.1.1 usage truth — read first

pi-charter v0.1.1 ships as a **compiled package** (`dist/` JavaScript plus declarations, one exported
entry point) with a bundled **Pi extension**. From Pi, the supported surface is the two tools the
extension registers — nothing handwritten, nothing temporary:

```text
charter_compile           compile bounded governance for the active session and admit the exact
                          artifact set for execution; returns an execution handle
charter_verify_execution  verify what this session ran against that admission, using that handle
```

Neither tool accepts capability booleans, a model inventory, a trust boundary, or a caller-chosen
compiler identity: those are derived from the live session or refused. There is no CLI and no
`/charter` command; the tools are the Pi-native interface.

Two supported library ways to invoke core:

```text
compileForTarget          the one blessed facade — use it from a host integration
compileViaPi / verifyExecutionViaPi
                          the library bridge — use it from TypeScript inside Pi; it derives the
                          environment evidence itself and mediates the active parent session only
```

Low-level functions (`resolveExecutionContract`, `bindExecutionTarget`,
`compileBoundRoleEnvelope`, …) remain public for advanced and internal use. Do **not** compose them
by hand when the facade covers the need, and never feed a target handoff into envelope compilation.
Adapters integrating their own runtime use the supported `createAdapterIntegration` contract; they
supply observations and core promotes them into trusted evidence.

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

`subagents` — execution is intentionally delegated to the subagents substrate. Charter translates
resolved truth into bounded handoff parameters; **Charter does not spawn, track, retry, or supervise
the child.**

Target is not capability. Capabilities come from environment **evidence**, never from a target name
or a caller-supplied boolean: a raw `capability_claim` is recorded as an unattested claim and can
never produce `ENFORCED`. Each declared constraint resolves to exactly one of `ENFORCED` (trusted,
attested capability plus an applicable canonical policy), `INSTRUCTED` (a policy applies but nothing
attests hard enforcement), `UNSUPPORTED` (no instruction substitutes for the missing primitive), or
`NOT_APPLICABLE` (this contract declares no policy for that dimension). Never claim a capability
merely because a target was selected.

`pi-intercom` is **optional** and external to Charter core. Use it only when communication between
existing sessions genuinely helps. It is not part of the Charter execution pipeline.

## Evidence truth in v0.1.1

```text
claim              ≠ attestation           a source name, a version string, and a boundary-shaped
                                            record establish nothing without the exact boundary that
                                            issued the candidate
ENFORCED           = trusted capability evidence + an applicable canonical policy
NOT_APPLICABLE     no policy for that dimension — nothing to enforce and nothing to instruct
assertion bound    ≠ assertion verified     only evidence that the exact bound verifier ran and
                                            passed moves a bound assertion to verified
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

```text
AUTHORITY_UNRESOLVED               → obtain explicit authority; do not pick the closest file
MODEL_UNAVAILABLE                  → use only a declared fallback; otherwise stop
UNSUPPORTED_BY_EXECUTION_TARGET    → instruction-level is not hard enforcement; do not pretend
CONTRACT_CONTRADICTION             → resolve the contradiction explicitly
HUMAN_DECISION_REQUIRED            → stop autonomous progression
```

Full meaning, inspection point, and forbidden guesses for every canonical code:
`references/refusals-and-next-actions.md`.

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

## Reference-first read discipline

For ordinary Charter use — authoring a contract, interpreting a result, explaining a boundary — the
path is:

```text
SKILL.md
     ↓
minimum relevant reference(s)
     ↓
construct / interpret / guide
     ↓
STOP
```

1. Read this `SKILL.md`.
2. Read only the reference(s) matching the current need.
3. Use those references to author or interpret the Charter artifact.
4. **STOP when the task can be answered truthfully.** Sufficient evidence is a stop condition.

Do not inspect core source merely to reconfirm facts this companion already answers.

### Source escalation ladder

```text
LEVEL 0   SKILL.md
LEVEL 1   the relevant companion reference(s)
LEVEL 2   src/index.ts — only when the installed public API identity/signature must be verified
LEVEL 3   one exact defining core file — only when a specific contradiction remains unresolved
STOP
```

Escalate only on an actual evidence gap:

```text
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
| Invoke the library correctly (facade first, Pi integration, adapter contract, evidence rules) | `references/library-usage.md` |
| Construct a TaskContract | `references/contract-authoring.md` |
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
