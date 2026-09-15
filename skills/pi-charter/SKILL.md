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

## v0.1 usage limitation — read first

pi-charter v0.1 ships as a **TypeScript library / pure governance compiler surface** (the exports of
`src/index.ts`). There is **no CLI, no Pi extension, no `/charter` command, and no `charter(...)`
tool**. This skill teaches correct adoption and interpretation; it does not execute Charter, and it
cannot produce governance artifacts on its own. If ergonomic direct invocation is later needed, that
is separate evidence for a thin integration tool — do not assume one exists.

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

Target is not capability. Capabilities come from an explicit environment-supplied snapshot
(`model_selection`, `fresh_session`, `tool_ceiling`, `file_scope_enforcement`,
`independent_review`), and each declared constraint resolves to `ENFORCED`, `INSTRUCTED`, or
`UNSUPPORTED`. Never claim a capability merely because a target was selected.

`pi-intercom` is **optional** and external to Charter core. Use it only when communication between
existing sessions genuinely helps. It is not part of the Charter execution pipeline.

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

## Progressive disclosure

| Need | Read |
|------|------|
| Invoke the TypeScript library correctly | `references/library-usage.md` |
| Construct a TaskContract | `references/contract-authoring.md` |
| Choose/understand role or target | `references/roles-and-targets.md` |
| Interpret refusal / escalation | `references/refusals-and-next-actions.md` |
| See complete bounded examples | `references/worked-examples.md` |

## Do not duplicate core policy

Charter core owns, and this skill must never restate as its own decision procedure:

```text
model fallback algorithm · monotonic narrowing · enforcement truth evaluation
scope subset logic · authority binding · escalation counters · receipt hashing
target capability validation
```

Use the pi-charter core result as truth. The skill may explain what a result means; it may not
re-derive it, and it may not decide a governance question Charter is built to decide.
