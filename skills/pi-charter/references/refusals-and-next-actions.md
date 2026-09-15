# Refusals and bounded next actions

Charter is fail-closed: it refuses rather than reporting softer truth. A refusal is information, not
an obstacle. Read it, satisfy the real missing authority, and re-run — or stop.

This file explains canonical core behavior so an operator can *interpret* a result. The core stays
authoritative: where this documentation and an actual Charter result appear to disagree, the result
wins and the difference is a documentation bug.

**Never** rewrite a contract purely to make a refusal disappear. Changing the task to change the
truth is an authority change and requires explicit human/project authority.

## Canonical error codes

### `INVALID_TASK_CONTRACT`

- **Means:** the contract's shape or a field value is not admissible — unknown field, wrong value,
  missing required part, unvalidated artifact handed to a later stage.
- **Inspect:** the reported `path` (dotted field path), then the field's admitted values.
- **Must not guess:** a replacement value to satisfy the schema. Do not silently drop a field the
  work actually needs; fix the field or stop.

### `AUTHORITY_UNRESOLVED`

- **Means:** an authority reference binds to zero sources or several sources, or no binder was
  supplied.
- **Inspect:** `authority.sources` and which source each reference actually identifies.
- **Must not guess:** "the closest file", "the obvious doc", or the whole repository. Exactly one
  binding per reference, or no resolution.

### `SCOPE_CONTRADICTION`

- **Means:** a scope entry escapes or ignores the declared `root` (absolute path, `..`).
- **Inspect:** `scope.files` / `scope.directories` against `root`.
- **Must not guess:** a rewritten path that "looks right". The declared scope was wrong, not the
  validator.

### `CONTRACT_REQUIRES_EXPLICIT_OVERRIDE`

- **Means:** an unrestricted scope entry was declared without `scope.allow_unrestricted: true`.
- **Inspect:** the offending scope entry.
- **Must not guess:** add the override yourself. Unrestricted scope is an explicit authority
  decision, never a convenience flag.

### `ACCEPTANCE_INVALID`

- **Means:** acceptance has no commands, no assertions, and no required review — or a command or
  assertion is not genuinely verifiable ("looks fine", "works properly").
- **Inspect:** `acceptance.commands`, `acceptance.assertions`, `acceptance.review`.
- **Must not guess:** an invented test command, or a vague wish restated as an assertion.

### `MODEL_UNAVAILABLE`

- **Means:** the routed tier's preferred model and every declared fallback are unavailable.
- **Inspect:** the model profile's `fallback` list and the environment availability snapshot.
- **Must not guess:** another tier's model, a "closest" or same-vendor substitute. Use only a
  declared fallback; otherwise stop.

### `ROUTING_UNRESOLVED`

- **Means:** the role's tier cannot be staffed at all by the supplied profile.
- **Inspect:** the model profile — an omitted or malformed tier entry.
- **Must not guess:** a silent downgrade to a different tier.

### `CONTRACT_CONTRADICTION`

- **Means:** the contract contradicts itself — e.g. a role that needs implementation authority with
  `code_write: false`, same-session review marked `independent`, a `tag`/`push`/`publish`/`deploy`
  action without its permission, or a capability snapshot describing a different target than the
  contract selected.
- **Inspect:** the named `path`.
- **Must not guess:** which side is "really" meant. Resolve the contradiction explicitly; a
  snapshot never substitutes for another target's truth.

### `HUMAN_DECISION_REQUIRED`

- **Means:** the bounded decision space is exhausted or has no truthful member: a declared limit was
  reached, an architecture contradiction has no Charter authority behind it, adjudication reached no
  bounded decision, or a resolved adjudication supplied no usable downstream role.
- **Inspect:** the execution outcome, the explicit counters, and `limits`.
- **Must not guess:** raise a limit, loop the same escalation, re-adjudicate, or self-assign the next
  step. Stop and ask a human.

### `UNSUPPORTED_BY_EXECUTION_TARGET`

- **Means:** the contract requires hard enforcement the target cannot supply (truth is `INSTRUCTED`
  or `UNSUPPORTED`), or requires review capability the target does not have (fresh session,
  independent review).
- **Inspect:** the enforcement truth per constraint and the capability snapshot.
- **Must not guess:** that instruction-level control equals enforcement, that a different target
  would obviously be fine, or that independence can be fabricated. Charter does not build the
  missing primitive; switching target requires a new, explicit contract decision.

## Bounded next-action vocabulary

Charter may decide exactly one bounded next action from a finished outcome plus explicit counters:

```text
PASS                             the declared acceptance was satisfied; stop
RETRY_SAME_ROLE                  one clean retry is admitted for the same role
ADJUDICATE                       one bounded adjudication is admitted (role: adjudicate)
DE_ESCALATE_TO_ROLE              return to the explicitly supplied downstream role
HUMAN_DECISION_REQUIRED          autonomous progression stops
STOP_MODEL_UNAVAILABLE           no model is re-selected or re-routed
STOP_UNSUPPORTED_BY_EXECUTION_TARGET  the capability gap stands; the target is not switched
```

These are decisions, not lifecycle states. No `QUEUED`, `RUNNING`, `WAITING`, `BLOCKED_WORKER`,
`RESUMING`, or `RECOVERING` exists — Charter cannot express them, so it cannot return them.

### Outcomes and counters

Admitted execution outcomes (evidence of finished bounded work, not worker state):

```text
SUCCESS · MECHANICAL_FAILURE · SEMANTIC_AMBIGUITY · AUTHORITY_CONTRADICTION
ARCHITECTURE_CONTRADICTION · MODEL_UNAVAILABLE · EXECUTION_TARGET_UNSUPPORTED
ADJUDICATION_RESOLVED · ADJUDICATION_UNRESOLVED
```

Counters are explicit and never defaulted (an absent counter is not zero):

```text
clean_retries_used · correction_rounds_used · semantic_escalations_used
```

Behavior worth remembering:

- the one-clean-retry policy is a policy constant, not a contract limit
- one `correct` pass is one correction round, bounded by `limits.correction_rounds`
- semantic ambiguity and authority contradiction share one escalation bound
- `ARCHITECTURE_CONTRADICTION` is a human decision — Charter holds no architecture authority
- a resolved adjudication de-escalates only to an explicitly supplied downstream role, never back to
  the adjudicator; a missing or self-referential downstream role is a human decision
- adjudication outcomes are only accepted from an adjudicating run
