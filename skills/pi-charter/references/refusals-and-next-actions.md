# Refusals and next operator actions

Charter is fail-closed: it refuses rather than reporting softer truth. A refusal is information, not
an obstacle. Read it, satisfy the real missing authority, and re-run — or stop.

The tool renders every refusal in an actionable shape, and the three parts are the contract:

```text
REFUSED

Reason:  <CODE> @ <path> and what failed
Retry:   YES, after <the minimal action> | NO, <why it is not retryable>
Remedy:  the minimal operator action that resolves it
```

`HUMAN_DECISION_REQUIRED` and `UNSUPPORTED_BY_EXECUTION_TARGET` are not retryable at all; the other
codes are retryable only after the stated remedy. No remedy ever widens authority: each one asks for
less ambiguity, never for more permission.

This file explains canonical core behavior so an operator can *interpret* a result. The core stays
authoritative: where this documentation and an actual Charter result appear to disagree, the result
wins and the difference is a documentation bug.

**Never** rewrite a contract purely to make a refusal disappear. Changing the task to change the
truth is an authority change and requires explicit human/project authority.

## Canonical error codes

### `INVALID_TASK_CONTRACT`

- **Means:** the contract's shape or a field value is not admissible — unknown field, wrong value,
  missing required part, unvalidated artifact handed to a later stage, or an unavailable/stale
  compiler build identity.
- **Inspect:** the reported `path` (dotted field path), then the field's admitted values. When the
  path is `compiler_identity` and the message names `COMPILER_IDENTITY_MISMATCH`, the running
  compiled artifact set no longer matches the recorded build identity: rebuild the package before
  compiling governance.
- **Must not guess:** a replacement value to satisfy the schema. Do not silently drop a field the
  work actually needs, and do not pass a compiler identity of your own; fix the field or stop.

### `AUTHORITY_UNRESOLVED`

- **Means:** an authority reference binds to zero sources or several sources, or no binder was
  supplied. On the simple operator surface it also means the named document is missing, empty,
  not a regular file, or resolves outside the declared root — including through a symlink.
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
- **Inspect:** the model profile's `fallback` list and the model availability evidence for the run
  (an attested registry inventory, or a raw claim — a claim is weaker and says so).
- **Must not guess:** another tier's model, a "closest" or same-vendor substitute. Use only a
  declared fallback; otherwise stop.

### `ROUTING_UNRESOLVED`

- **Means:** the role's tier cannot be staffed at all by the supplied profile.
- **Inspect:** the model profile — an omitted or malformed tier entry.
- **Must not guess:** a silent downgrade to a different tier.

### `CONTRACT_CONTRADICTION`

- **Means:** the contract contradicts itself — e.g. a role that needs implementation authority with
  `code_write: false`, same-session review marked `independent`, a `tag`/`push`/`publish`/`deploy`
  action without its permission, or capability evidence describing a different target than the
  contract selected.
- **Inspect:** the named `path`.
- **Must not guess:** which side is "really" meant. Resolve the contradiction explicitly; evidence
  about one target never substitutes for another target's truth.

### `HUMAN_DECISION_REQUIRED`

- **Means:** current truth is ambiguous and Charter has no authority to choose the missing decision.
- **Inspect:** the named contradiction or missing owner choice.
- **Must not guess:** a permission, authority source, architecture choice, or downstream task. Stop and ask the owner; any later correction/adjudication is a new explicitly bounded Charter task.

### `UNSUPPORTED_BY_EXECUTION_TARGET`

- **Means:** the contract requires hard enforcement the target cannot supply (truth is `INSTRUCTED`,
  `UNSUPPORTED`, or `NOT_APPLICABLE` for a required constraint), or requires review capability the
  target does not have (fresh session, independent review). A capability CLAIM can never satisfy
  this: only trusted, attested evidence plus an applicable policy reaches `ENFORCED`.
- **Inspect:** the enforcement truth per constraint and the capability evidence for the target.
- **Must not guess:** that instruction-level control equals enforcement, that a different target
  would obviously be fine, or that independence can be fabricated. Charter does not build the
  missing primitive; switching target requires a new, explicit contract decision.

## After a refusal

Charter does not own a retry/escalation workflow. Resolve the refusal at its source, then submit a new bounded task if more work is needed. `correct` and `adjudicate` remain explicit roles; they are never entered automatically.
