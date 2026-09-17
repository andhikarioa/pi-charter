# Pi Charter Architecture

## Thesis

Pi Charter is a **governance compiler, not an execution runtime**.

Its unique job is:

> Given a task, determine what is authorized, where work may happen, what model/target is resolved, what the runtime can actually enforce, and compile one bounded instruction without pretending unsupported guarantees exist.

## One-page mental model

```text
Operator / TaskContract
        ↓
shape + semantic validation
        ↓
bind authority exactly once
        ↓
ExecutionContract
(single rich resolved truth)
        ↓
bind target capability exactly once
        ↓
TargetBinding
        ↓
┌──────────────────────┬──────────────────────┬─────────────────────┐
│ bounded instruction  │ target handoff       │ minimal receipt     │
└──────────────────────┴──────────────────────┴─────────────────────┘
        ↓
Pi/substrate executes outside Charter
```

There is no Charter-owned post-run lifecycle.

## Canonical truth ownership

### TaskContract

Caller intent: role, task, authority references, root/scope, permissions, acceptance, requirements, and routing-relevant fields.

### ExecutionContract

The **one rich canonical resolved artifact**. It owns resolved model, authority provenance, scope, permissions, acceptance bindings, correction targets, and declared enforcement requirements.

### TargetBinding

Adds target capability truth to the resolved contract. It is computed once per compile.

### Instruction / handoff / receipt

These are projections of established truth:

- instruction tells the agent what bounded work means;
- target handoff translates already-bound truth for `parent` or `subagents`;
- receipt records what was compiled.

They do not independently re-resolve governance.

## Protected invariants

1. Authority cannot be invented.
2. Missing or ambiguous authority fails closed.
3. Authority provenance binds actual content identity.
4. Scope cannot silently expand or escape root.
5. Mutation permission is explicit.
6. Review-only roles remain read-only.
7. Correction authority is limited to accepted named correction targets.
8. Model resolution never silently substitutes an undeclared fallback.
9. Runtime capability claims are not trusted observations.
10. Caller claims cannot produce `ENFORCED`.
11. `ENFORCED`, `INSTRUCTED`, `UNSUPPORTED`, and `NOT_APPLICABLE` remain distinct.
12. Hard requirements unsupported by the selected target fail closed.
13. Unknown governance-bearing fields are rejected.
14. A fresh session is not automatically an independent or external audit.
15. A subagent handoff never claims child execution.
16. A receipt never becomes run history or workflow authority.
17. Charter does not own workers, scheduler, leases, retries, recovery, or execution lifecycle.

## Enforcement truth

```text
trusted runtime observation + applicable primitive → ENFORCED
policy but no trusted hard primitive              → INSTRUCTED
required primitive unavailable                    → UNSUPPORTED / refuse
no policy in this dimension                       → NOT_APPLICABLE
```

This distinction is a primary Charter guarantee and must not be weakened for convenience.

## Supported boundaries

### Pi operator boundary

One tool: `charter_compile`.

Simple intent is normalized into the canonical contract. The installed Pi seam observes only facts it can actually know from Pi.

### TypeScript boundary

The supported SDK is centered on:

- `compileForTarget`;
- `compileDelegation`;
- `createAdapterIntegration`;
- binder helpers and input/output types needed by those facades.

Individual compiler phases are internal. This keeps intermediate artifacts from becoming compatibility/trust boundaries.

## What Charter does not own

```text
execution runtime
scheduler
worker lifecycle
lease/recovery
post-run verification
retry/escalation workflow
persistent run ledger
external audit
```

If one of these starts appearing in Charter, require a concrete protected invariant that cannot be provided by the substrate before accepting it.

## Maintenance rule

For every subsystem ask:

> What protected invariant does this defend?

Then:

> Can the same invariant survive with fewer concepts?

A mechanism that protects only future extensibility, formal completeness, or architectural neatness is not enough justification for this one-operator tool.

## Verification layers

```text
inner loop      deterministic tests
normal verify   typecheck + full tests
integration     compiler smoke + external consumer smoke
Pi integration  Pi smoke when Pi is available
release         pack dry-run + tag + short release note
```

Historical master specs document how earlier versions were built. They are not architecture authority for ordinary maintenance; current source, tests, this document, and the active slimming audit/plan are sufficient.
