# Library usage — TypeScript invocation for operators

```text
The skill guides.
The library decides.
The execution substrate executes.
```

pi-charter v0.1 is a pure TypeScript library exported through `pi-charter` (`src/index.ts`). There is
no CLI, no `/charter` command, no Pi extension, and no runtime tool. Callers invoke pure compiler
functions to validate, resolve, bind, and compile governance artifacts.

---

## Minimal explicit setup

The compiler requires explicit inputs at each stage. Nothing is inferred, discovered, or globally
defaulted.

### A — Authority binder

Use `createAuthorityBinder(...)` to bind authority references to exact source identities:

```ts
import { createAuthorityBinder } from 'pi-charter';

const authorityBinder = createAuthorityBinder({
  'canonical-master': { path: 'docs/SPEC.md' },
});
```

Examples use exact string identities only. There is no fuzzy binding, no filename guessing, and no
search heuristic. Any unmapped or ambiguous reference fails closed with `AUTHORITY_UNRESOLVED`.

### B — Resolver environment

Resolving a contract requires an explicit `ModelProfile`, an availability snapshot, and the
`AuthorityBinder`:

```ts
import type { ModelProfile } from 'pi-charter';

const profile: ModelProfile = {
  workhorse: { preferred: 'claude-3-7-sonnet', fallback: ['claude-3-5-sonnet'] },
  reviewer: { preferred: 'gpt-4o', fallback: [] },
  reasoning: { preferred: 'o3-mini', fallback: [] },
};

const available = ['claude-3-7-sonnet', 'gpt-4o', 'o3-mini'];
```

Do not define hidden or global defaults. Concrete model identities in this environment configuration
are illustrative environment configuration, **NOT** TaskContract role routing decisions.

Contracts declare governance fields (`role`, `class`, `risk`). The resolver maps the role to a model
tier (`workhorse`, `reviewer`, `reasoning`), and only then resolves that tier against the profile
and the current availability snapshot.

### C — Resolve execution contract

Invoke `resolveExecutionContract`:

```ts
import { resolveExecutionContract } from 'pi-charter';

const resolved = resolveExecutionContract(taskContract, {
  authorityBinder,
  profile,
  available,
});

if (!resolved.ok) {
  // inspect resolved.errors and STOP
  console.error('Resolution failed:', resolved.errors);
  throw new Error('Resolution failed closed');
}

const executionContract = resolved.contract;
```

Resolution runs Phase 1 validation internally and fails closed. If `!resolved.ok`, inspect
`resolved.errors` and stop. Do not teach callers or operators to patch inputs until they pass: an
error signals missing authority, unstaffable tiers, or a contradiction that must be addressed at its
source.

### D — Bind execution-target truth

Bind the resolved `ExecutionContract` to target capabilities:

```ts
import { bindExecutionTarget, type ExecutionTargetCapabilitySnapshot } from 'pi-charter';

const capability_snapshot: ExecutionTargetCapabilitySnapshot = {
  name: 'parent',
  capabilities: {
    model_selection: true,
    fresh_session: false,
    tool_ceiling: false,
    file_scope_enforcement: false,
    independent_review: false,
  },
};

const binding = bindExecutionTarget({
  execution_contract: executionContract,
  capability_snapshot,
});

if (!binding.ok) {
  // inspect binding.errors and STOP
  console.error('Binding failed:', binding.errors);
  throw new Error('Binding failed closed');
}
```

The snapshot is **environment-supplied truth**, not a target default. Do not imply this sample
snapshot is permanent parent or subagents truth: capabilities reflect what the execution substrate
can actually hard-enforce at this moment. If the contract requires hard enforcement that the snapshot
cannot provide, binding fails closed with `UNSUPPORTED_BY_EXECUTION_TARGET`.

### E — Compile RoleEnvelope

Compile the target binding into a role envelope:

```ts
import { compileBoundRoleEnvelope } from 'pi-charter';

const envelopeResult = compileBoundRoleEnvelope(binding.binding);

if (!envelopeResult.ok) {
  console.error('Envelope compilation failed:', envelopeResult.errors);
  throw new Error('Envelope compilation failed closed');
}

const roleEnvelope = envelopeResult.envelope;
```

The returned `RoleEnvelope` is an **instruction artifact**. It compiles what the role may do, what it
is prohibited from doing, and when it must stop. **It does not execute anything.** Execution remains
the responsibility of the substrate.

---

## Adapter paths

Charter exposes thin adapter helpers for handoff:

```ts
import { bindParentTarget, bindSubagentsTarget } from 'pi-charter';

const parentHandoff = bindParentTarget({
  execution_contract: executionContract,
  capability_snapshot,
});

const subagentsHandoff = bindSubagentsTarget({
  execution_contract: executionContract,
  capability_snapshot: subagentsSnapshot,
});
```

These are **thin target handoff surfaces**. Do not conflate them with the core RoleEnvelope compiler:

- `RoleEnvelope` remains a core artifact.
- Do not claim `SubagentsHandoff` itself is a `RoleEnvelope`. `SubagentsHandoff` merely extracts
  resolved parameters (`model`, `fresh_session_required`, `enforcement`) for delegating execution.
- No child spawning occurs: neither adapter creates sessions, spawns workers, manages processes, or
  monitors execution.

---

## Optional advanced surfaces

### Next action decision

Charter provides a pure decision function for post-execution governance:

```ts
import { decideNextAction } from 'pi-charter';

const decision = decideNextAction({
  role_envelope: roleEnvelope,
  outcome: 'MECHANICAL_FAILURE',
  counters: {
    clean_retries_used: 0,
    correction_rounds_used: 0,
    semantic_escalations_used: 0,
  },
});
```

Input is:
```text
explicit RoleEnvelope
+ outcome
+ counters
→ one decision
```

`decideNextAction` evaluates the outcome against contract limits and the one-clean-retry rule. It
returns a decision (`PASS`, `RETRY_SAME_ROLE`, `ADJUDICATE`, `HUMAN_DECISION_REQUIRED`, etc.).
**It does not execute the action.**

### Resolution receipt

For audit or verification records, create a deterministic receipt:

```ts
import { createResolutionReceipt } from 'pi-charter';

const receipt = createResolutionReceipt({
  task_contract: taskContract,
  authority_binder: authorityBinder,
  model_profile: profile,
  model_availability: available,
  capability_snapshot,
  target_binding: binding.binding,
});
```

A receipt is an **optional evidence artifact** with SHA-256 identities over pipeline inputs and
results. It provides **no persistence, no cache, and no workflow authority**.

---

## Minimum end-to-end code sample

Complete TypeScript example: `TaskContract` → resolver → target binding → `RoleEnvelope`.

```ts
import {
  bindExecutionTarget,
  compileBoundRoleEnvelope,
  createAuthorityBinder,
  renderRoleEnvelope,
  resolveExecutionContract,
  type ExecutionTargetCapabilitySnapshot,
  type ModelProfile,
  type TaskContract,
} from 'pi-charter';

// 1. Structured TaskContract input
const taskContract: TaskContract = {
  version: 'charter/v0.1',
  task: {
    id: 'bounded-fix',
    class: 'T2',
    risk: 'medium',
  },
  role: 'implement',
  execution_target: 'parent',
  root: '/absolute/project/root',
  authority: {
    sources: ['canonical-master'],
  },
  scope: {
    files: ['internal/example.go'],
  },
  permissions: {
    code_write: true,
    research: false,
    external_write: false,
    release: false,
  },
  acceptance: {
    commands: ['go test ./...'],
    review: {
      required: true,
      independence: 'none',
      executor: 'same_session',
    },
  },
  verification: {
    level: 'V2',
  },
  limits: {
    correction_rounds: 1,
  },
  non_goals: ['architecture redesign'],
};

// 2. Explicit environment inputs
const authorityBinder = createAuthorityBinder({
  'canonical-master': { doc: 'Approved spec v1' },
});

const profile: ModelProfile = {
  workhorse: { preferred: 'claude-3-7-sonnet', fallback: ['claude-3-5-sonnet'] },
  reviewer: { preferred: 'gpt-4o', fallback: [] },
  reasoning: { preferred: 'o3-mini', fallback: [] },
};

const available = ['claude-3-7-sonnet', 'gpt-4o', 'o3-mini'];

const capability_snapshot: ExecutionTargetCapabilitySnapshot = {
  name: 'parent',
  capabilities: {
    model_selection: true,
    fresh_session: false,
    tool_ceiling: false,
    file_scope_enforcement: false,
    independent_review: false,
  },
};

// 3. Resolve ExecutionContract
const resolved = resolveExecutionContract(taskContract, {
  authorityBinder,
  profile,
  available,
});

if (!resolved.ok) {
  console.error('Contract resolution failed:', resolved.errors);
  process.exit(1);
}

// 4. Bind execution-target truth
const binding = bindExecutionTarget({
  execution_contract: resolved.contract,
  capability_snapshot,
});

if (!binding.ok) {
  console.error('Target binding failed:', binding.errors);
  process.exit(1);
}

// 5. Compile RoleEnvelope
const compiled = compileBoundRoleEnvelope(binding.binding);

if (!compiled.ok) {
  console.error('RoleEnvelope compilation failed:', compiled.errors);
  process.exit(1);
}

// 6. Render envelope to instruction text for executor prompt
const instructions = renderRoleEnvelope(compiled.envelope);
console.log(instructions);
```
