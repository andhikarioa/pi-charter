# Roles and execution targets

## Three distinctions to keep straight

```text
role   ≠ permission   A role states governance purpose; permissions are granted by the contract
                      and can only be narrowed in resolution, never widened.
role   ≠ model        Core routing maps the role to a model tier. Never name a model yourself.
target ≠ capability   Selecting `subagents` grants nothing; capability requires trusted, attested
                      evidence about that target — a claim about it proves nothing.
```

## The five roles

### `planner`

Purpose: decompose already-admitted, sufficiently frozen work into a small number of independently
verifiable bounded units.

- read-only; produces contracts and plans, not repository mutations
- not for inventing product capability, roadmaps, release thesis, or product architecture
- must not broaden admitted scope or increase authority
- aggregate authority/scope of its output must stay equal to or narrower than its input

### `implement`

Purpose: implement one bounded task whose product semantics and architecture are already frozen.

- repository mutation is task-controlled, and requires `permissions.code_write`
- implementation authority is bounded; product semantics and architecture authority are `none`
- must not invent product semantics, reopen architecture, or drift into unrelated refactoring

### `review`

Purpose: evaluate implementation against named contracts, acceptance criteria, and authorized
invariants.

- read-only; bounded finding authority; no scope expansion; no architecture authority
- may report PASS, MATERIAL_FINDINGS, or BLOCKED
- a clean PASS is a valid, complete result — a reviewer is not obliged to find something
- must not silently become implementation

**Review independence truth.** `same_session` review is `independence: none`. Independent review
means a fresh session and substrate-level independence; if the selected target cannot supply that,
the binding is refused rather than the claim softened. Never describe same-session review as
independent.

### `correct`

Purpose: apply only frozen, accepted findings from a prior review or adjudication result.

- writes are task-controlled; input scope is accepted findings only
- requires **named accepted findings with provenance**. With no named accepted blocker/finding, do not
  construct a `correct` execution: there is nothing admitted to correct
- a bound authority source grounds a named finding; it is never itself a finding, and current
  authority does not substitute for accepted-finding provenance
- must not reopen the reviewer's jurisdiction or invent additional findings

### `adjudicate`

Purpose: resolve **one** bounded semantic, authority, or contract contradiction that materially
blocks truthful execution.

- read-only; semantic authority is bounded to the named contradiction
- holds no architecture authority and no product semantics
- not a general architecture owner, not an implementation role
- produces a bounded decision and returns execution to an explicitly supplied downstream role
  (never to itself)

## Model tiers — core routing owns them

```text
planner / implement / correct  → workhorse tier
review                         → reviewer tier
adjudicate                     → reasoning tier
```

Task class and risk are routing inputs but do not change the tier in v0.1. Charter resolves
preferred/fallback models under the availability EVIDENCE supplied for the run: an attested registry
inventory is trusted truth, and a raw list is recorded as a claim. It never substitutes a guess. Do
not name models, tiers, or fallbacks in plans, prompts, or handoffs.

## Execution targets

### `parent`

The active parent Pi session executes the resolved contract directly. This is first-class, not a
fallback, and it requires neither subagents nor intercom. A sequence such as planner → implement →
review → correct → adjudicate may all happen in the same parent session when the contract permits —
with the contract staying truthful about review independence.

### `subagents`

Execution is intentionally delegated to the subagents substrate. Charter translates already-resolved
truth into bounded handoff parameters (role, resolved model identity, fresh-session requirement,
enforcement truth, contract). It spawns no child, tracks no child, retries nothing, and owns no
worktree, process, lock, or child lifecycle — that is substrate responsibility.

Selecting `subagents` is not a capability claim. Capability is exactly what the run's environment
evidence establishes — never what the target name suggests.

## Capability evidence and enforcement truth

Capability axes (all five must be stated explicitly when a capability is supplied):

```text
model_selection · fresh_session · tool_ceiling · file_scope_enforcement · independent_review
```

A raw claim is recorded as an `unattested_claim` and can never produce `ENFORCED`. Only trusted,
attested capability evidence — the exact boundary that issued it — plus an applicable canonical
policy reaches `ENFORCED`.

Enforcement truth per declared constraint:

```text
ENFORCED          trusted, attested capability + an applicable canonical policy
INSTRUCTED        a policy applies, but nothing attests hard enforcement
UNSUPPORTED       no instruction substitutes for the missing primitive
NOT_APPLICABLE    this contract declares no policy for that dimension
```

`model_selection` is `UNSUPPORTED` (not `INSTRUCTED`) without the capability, because no prompt can
change which model actually executes. `archaeology_off` and `release_forbidden` are always
`INSTRUCTED`: the prohibition reaches the worker, but the target cannot prove compliance.
`NOT_APPLICABLE` is not a softer `ENFORCED`, and it is not "all tools allowed" — there is simply no
policy to enforce.

## Intercom

`pi-intercom` is optional and external. It may carry cross-session communication such as decision
requests, semantic/authority contradictions, or progress updates. Charter core works without it, and
it is not part of the Charter execution pipeline.
