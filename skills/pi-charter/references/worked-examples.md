# Worked examples

Five small shapes showing input truth, the expected Charter result, what the executor may then do,
and exactly where execution stops. These are expectation sketches, not runtime transcripts — nothing
here claims the skill executed Charter.

---

## A. Parent bounded implementation

```yaml
version: charter/v0.1
task: { id: bounded-fix, class: T2, risk: medium }
role: implement
execution_target: parent
root: /absolute/project/root
authority: { sources: [canonical-master] }
scope: { files: [internal/example.go] }
permissions: { code_write: true, research: false, external_write: false, release: false }
acceptance: { commands: [go test ./...], review: { required: true, independence: none, executor: same_session } }
verification: { level: V2 }
limits: { correction_rounds: 1 }
```

- **Expected result:** validated and resolved; parent target bound; role envelope compiled for
  `implement` with bounded scope, `code_write` effective, no hard-enforcement requirement, so no
  enforcement refusal is possible.
- **Executor may:** edit only within declared scope, run the declared acceptance, report an outcome.
- **Stops at:** the declared files, the declared acceptance, and one correction round. Nothing
  invites a broader refactor; a same-session review must be reported as not independent.

---

## B. Subagents independent review

```yaml
version: charter/v0.1
task: { id: independent-review, class: T1, risk: medium }
role: review
execution_target: subagents
root: /absolute/project/root
authority: { sources: [bounded-change-contract] }
scope: { files: [internal/example.go] }
permissions: { code_write: false, research: false, external_write: false, release: false }
acceptance: { assertions: [findings-reported], review: { required: true, independence: independent, executor: fresh_session } }
verification: { level: V3 }
```

- **Expected result:** if the snapshot states `fresh_session: true` and `independent_review: true`,
  the review binds and a handoff is produced carrying the resolved model identity and actual
  enforcement truth. Otherwise: `UNSUPPORTED_BY_EXECUTION_TARGET`.
- **Executor may:** read the named scope, evaluate against the named contract, report PASS or
  findings.
- **Stops at:** read-only scope. A clean PASS is complete — no fix is written by this role, and
  independence is never asserted unless the substrate supplies it.

---

## C. Named-finding correction

```yaml
version: charter/v0.1
task: { id: correct-blocker-a, class: T3, risk: high }
role: correct
execution_target: parent
root: /absolute/project/root
authority: { sources: [canonical-master, reviewer-findings] }
scope: { blockers: [blocker-a], files: [internal/example.go, internal/example_test.go] }
permissions: { code_write: true, research: false, external_write: false, release: false }
acceptance: { commands: [go test ./...], assertions: [blocker-a-eliminated], review: { required: true, independence: none, executor: same_session } }
verification: { level: V3 }
limits: { correction_rounds: 2, semantic_escalations: 1 }
```

- **Expected result:** the contract validates and resolves with `blocker-a` carried as the named
  correction target; resolution does not broaden the blocker/file scope. During `RoleEnvelope`
  compilation, `correct` is admitted because at least one named `scope.blocker` exists. The bound
  authority sources ground that target; they are not themselves findings.
- **Executor may:** apply the accepted correction and verify it with the declared commands.
- **Stops at:** the named finding. With no named accepted blocker, do not construct a `correct`
  execution at all — and do not invent a new finding to fill the gap.

---

## D. Bounded adjudication

```yaml
version: charter/v0.1
task: { id: resolve-contradiction, class: T3, risk: high }
role: adjudicate
execution_target: parent
root: /absolute/project/root
authority: { sources: [canonical-master] }
scope: { sections: [authority-model] }
permissions: { code_write: false, research: false, external_write: false, release: false }
acceptance: { assertions: [contradiction-decided] }
verification: { level: V3 }
limits: { semantic_escalations: 1 }
```

- **Expected result:** read-only envelope with bounded semantic-adjudication authority — no
  architecture authority, no mutation. After SEMANTIC_AMBIGUITY inside the declared limit, the
  admitted next action is `ADJUDICATE`; once the limit is reached, `HUMAN_DECISION_REQUIRED`.
- **Executor may:** decide the one named contradiction and report
  `ADJUDICATION_RESOLVED` / `ADJUDICATION_UNRESOLVED`.
- **Stops at:** the named contradiction. De-escalation requires an explicitly supplied downstream
  role — never the adjudicator itself; and this role never implements its own decision.

---

## E. Unsupported hard enforcement

```yaml
version: charter/v0.1
task: { id: hard-ceiling-work, class: T2, risk: medium }
role: implement
execution_target: parent
root: /absolute/project/root
authority: { sources: [canonical-master] }
scope: { files: [internal/example.go] }
permissions: { code_write: true, research: false, external_write: false, release: false }
acceptance: { commands: [go test ./...] }
verification: { level: V2 }
requirements:
  enforcement:
    allowed_tools: required
    release_forbidden: required
```

- **Expected result:** with a snapshot where `tool_ceiling: false`, the tool ceiling truth is
  `INSTRUCTED`, so requiring it refuses with `UNSUPPORTED_BY_EXECUTION_TARGET`. `release_forbidden`
  is always instruction-level in v0.1 and refuses for the same reason.
- **Executor may:** nothing under this contract.
- **Stops at:** the refusal. Do not soften the requirement, do not assert that instruction-level
  equals enforcement, and do not switch target on your own — an acceptable target must be a new,
  explicit contract decision.

---

## Cross-example rule

In every example, the executor's freedom ends where the contract's declared truth ends: no wider
scope, no additional findings, no self-selected model, no fabricated independence, no invented
escalation. When Charter refuses, the fix is more explicit authority — or a stop.
