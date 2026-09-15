# Contract authoring — `TaskContract` for operators

A `TaskContract` is **explicit authority**. Structured fields are authoritative; nothing is inferred
from prose, and no field is guessed by the reader.

Authoring rule of thumb:

```text
explicit   > inferred
bounded    > broad
observable > vague wishes
```

Unknown fields are refused, not ignored: the schema is closed.

## Fields and what they mean for the operator

| Field | Values / shape | Operator note |
|-------|----------------|---------------|
| `version` | `charter/v0.1` | Fixed. Any other value is invalid. |
| `task.id` | non-empty string | One identity per bounded piece of work. |
| `task.class` | `T0`–`T4` | Governance weight, not an authority grant. `T4` requires `task.evidence[]`. |
| `task.risk` | `low` / `medium` / `high` / `critical` | Risk is a routing input; it never grants authority. |
| `task.evidence` | string list | Required for `T4`; the evidence backing that class. |
| `role` | `planner` / `implement` / `review` / `correct` / `adjudicate` | Governance role, not a model. |
| `execution_target` | `parent` / `subagents` | Exactly two in v0.1. |
| `root` | absolute path | Everything scope-relative resolves here. |
| `authority.sources` | non-empty string list | Each reference must bind to **exactly one** source. Ambiguity is a refusal. |
| `scope.blockers` | string list | Named blockers/findings the work is bound to. |
| `scope.files` / `scope.symbols` / `scope.directories` | string list | Root-relative. Absolute paths and `..` escapes are contradictions. |
| `scope.sections` | string list | Named contract sections in scope. |
| `scope.allow_unrestricted` | boolean | Only explicit admission of wildcard scope. Absent ⇒ wildcard scope fails closed. |
| `permissions.code_write` | boolean | Repository writes. Additionally requires a role that may write. |
| `permissions.research` | boolean | Research is off unless granted here. |
| `permissions.external_write` | boolean | Required for `push`. |
| `permissions.release` | boolean | Required for `tag`, `publish`, `deploy`. Always explicit. |
| `acceptance.commands` | string list | Must be genuinely verifiable; fuzzy phrasing is refused. |
| `acceptance.assertions` | string list | Machine-checkable identifiers, not wishes. |
| `acceptance.review.required` | boolean | `true` alone can satisfy acceptance — and it obliges the target to actually provide that review. |
| `acceptance.review.independence` | `none` / `independent` | `same_session` + `independent` is a contradiction. |
| `acceptance.review.executor` | `same_session` / `fresh_session` | Must be truthful about where review happens. |
| `verification.level` | `V0`–`V5` | V0 inspection/reasoning · V1 focused tests · V2 local gates · V3 bounded adversarial review · V4 staging/live integration · V5 release/production. |
| `limits.correction_rounds` | non-negative integer | Bound for `correct` rounds. Undeclared ⇒ not a bound. |
| `limits.semantic_escalations` | non-negative integer | Bound for bounded adjudication. |
| `actions` | `tag` / `push` / `publish` / `deploy` | Each requires its matching permission; otherwise contradictory. |
| `non_goals` | string list | Cheap, high-value: state what this work must not become. |
| `requirements.enforcement` | see below | Declares what the target must **hard-enforce**. |

## Hard-enforcement requirements

Five named constraints exist; each admitted value is exactly `required`:

```text
model_selection
allowed_tools
allowed_files
archaeology_off
release_forbidden
```

Declaring one `required` is a claim that instruction-level control is not good enough. In v0.1 only
`model_selection`, `allowed_tools`, and `allowed_files` can ever reach `ENFORCED`, and only when the
target's capability snapshot says so; `archaeology_off` and `release_forbidden` always report
instruction-level. A required constraint that the target cannot hard-enforce refuses the binding —
Charter does not build the missing primitive to make it pass.

## Validation/resolution failures that most often bite

- acceptance with no commands, no assertions, and no required review
- role with `code_write: true` and no bounded scope entries
- wildcard scope without `scope.allow_unrestricted: true`
- `actions` requested without the permission they need
- `same_session` review described as `independent`
- authority references that bind to zero or many sources
- role whose purpose needs implementation authority paired with `code_write: false`

## Compact illustrative contract

```yaml
version: charter/v0.1

task:
  id: example-bounded-change
  class: T2
  risk: medium

role: implement
execution_target: parent
root: /absolute/project/root

authority:
  sources:
    - canonical-master

scope:
  files:
    - internal/example.go
    - internal/example_test.go

permissions:
  code_write: true
  research: false
  external_write: false
  release: false

acceptance:
  commands:
    - go test ./...
  assertions:
    - bounded-change-present
  review:
    required: true
    independence: none
    executor: same_session

verification:
  level: V2

limits:
  correction_rounds: 1
  semantic_escalations: 1

non_goals:
  - architecture redesign
  - unrelated refactor
```

Notes: this admits a single bounded implementation on the parent target, offers one bounded
correction round, and declares no hard-enforcement requirement — so it can never claim enforcement
it did not ask for. Add `requirements.enforcement` only when instruction-level control is genuinely
insufficient, and expect a refusal if the selected target cannot supply it.
