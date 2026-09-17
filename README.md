# Pi Charter

A small, fail-closed governance compiler for bounded Pi coding work. You provide the intent, authority, scope, and acceptance gates; Charter binds authority evidence, verifies target capability truth, and renders bounded instructions and minimal receipts before execution begins.

> 🛡️ **Compile-time governance only:** Charter answers what is permitted and instructed *before* work starts. It deliberately does not execute tasks, monitor children, schedule retries, track run lifecycles, or claim post-execution success.

**Current release: v0.2.1** — sealed maintenance release. Zero runtime dependencies, one Pi tool (`charter_compile`), fail-closed validation.

```text
intent → authority & scope → model & capability truth → bounded instruction → minimal receipt → Pi executes
```

## Contents

- [🚀 Quick Start](#-quick-start)
- [🛡️ Governance & Safety Model](#️-governance--safety-model)
- [🎯 Execution Targets](#-execution-targets)
- [🔍 Enforcement Truth](#-enforcement-truth)
- [📜 Authority & Scope](#-authority--scope)
- [🤖 Pi-Native Operation (`charter_compile`)](#-pi-native-operation-charter_compile)
- [📦 TypeScript API](#-typescript-api)
- [⚠️ Deliberate Boundaries](#️-deliberate-boundaries)
- [✅ Verification & Quality Gates](#-verification--quality-gates)
- [📄 Repository & License](#-repository--license)

---

## 🚀 Quick Start

### 1. In Pi (Agent Operator)

Pi automatically discovers Charter and registers one tool: `charter_compile`.

Pass your task intent directly to compile bounded governance:

```json
{
  "task": "Fix the parser bug described in PLAN.md",
  "role": "implement",
  "target": "parent",
  "authority": "PLAN.md",
  "scope": ["src/parser/**"],
  "gates": ["npm test"]
}
```

Charter validates authority, scopes the target, and outputs the rendered role envelope:

```text
ALLOWED

Role          implement
Target        parent
Model         <resolved model>
Scope         src/parser/**

Authority     BOUND
Enforcement   <truth by constraint>
Acceptance    commands DECLARED (1); verifier evidence UNAVAILABLE

Charter compiled bounded governance for this task. Execution remains owned by Pi.
```

If any constraint is violated (e.g., missing authority document or path escape), Charter fails closed with `REFUSED`, explaining the reason and minimal remedy.

### 2. In TypeScript (Library Consumer)

Install or link `pi-charter` (requires Node.js `>=22.0.0`, zero runtime dependencies):

```ts
import { compileForTarget, createAuthorityBinder } from 'pi-charter';

const result = compileForTarget({
  task_contract: {
    version: 'charter/v0.1',
    task: { id: 'parser-fix', class: 'T1', risk: 'medium' },
    role: 'implement',
    execution_target: 'parent',
    root: '/projects/my-app',
    authority: { sources: ['task-spec'] },
    scope: { files: ['src/parser/**'] },
    permissions: { code_write: true, research: false, external_write: false, release: false },
    acceptance: { commands: ['npm test'] },
    verification: { level: 'V1' },
  },
  authority_binder: createAuthorityBinder({
    'task-spec': { doc: 'PLAN.md', revision: '1' },
  }),
  model_profile: { workhorse: { preferred: 'my-model', fallback: [] } },
  available: ['my-model'],
  capability_claim: {
    name: 'parent',
    capabilities: {
      model_selection: false,
      fresh_session: false,
      tool_ceiling: false,
      file_scope_enforcement: false,
      independent_review: false,
    },
  },
});

if (result.ok) {
  console.log('Contract compiled:', result.compiled.resolution_receipt.compiler_identity);
}
```

---

## 🛡️ Governance & Safety Model

CAN DO != MAY DO: Charter compiles bounded authority into explicit policy constraints before execution starts.

| Invariant | What it means for you |
|---|---|
| Compile-time boundary | Charter stops after compilation and handoff. Execution remains owned by Pi or the host runtime. |
| Evidence over claims | Authority is bound from real, readable files by content identity. Caller claims cannot promote to `ENFORCED`. |
| Fail-closed authority | Missing, ambiguous, unreadable, or root-escaping authority documents are immediately `REFUSED`. |
| Bounded scope | Write-capable roles require explicit path scopes. Lexical (`..`) or real filesystem escapes fail closed. |
| Honest capability truth | Distinguishes what the substrate physically enforces from what it merely instructs. |
| Separation of proof | Declared acceptance commands are not proof of passing. Fresh sessions are not independent audits. |
| Zero runtime dependencies | Pure TypeScript and Node.js standard library. No bloated dependency tree or supply-chain risk. |

> 🛡️ **Charter never widens authority:** If a request is invalid or under-authorized, Charter refuses it. It will never silently broaden scope, infer unstated permissions, or guess authority to make compilation succeed.

---

## 🎯 Execution Targets

Charter supports two bounded execution targets:

| Target | Execution Owner | Output | Key Boundary |
|---|---|---|---|
| `parent` | Current active Pi session | Rendered role envelope | Pi owns execution; Charter has no post-run handle or verifier |
| `subagents` | Delegated child agent | Bounded `HANDOFF_READY` payload | Parameters ready; does NOT prove child launch or execution |

### `parent`

Charter compiles governance for the active Pi session. Pi observes the live provider, model, and session, and displays the compiled boundaries in the conversation. Once compiled, Pi executes the task. Charter does not track the run lifecycle or inspect post-run status.

### `subagents`

Charter validates delegation intent and produces a bounded handoff package for child subagents.

> ⚠️ **`HANDOFF_READY` is not execution proof:** Receiving `HANDOFF_READY` means the delegation contract, model routing, and scope parameters are valid. It never proves that a child subagent was launched, completed the work, or abided by the instructions.

### Fresh-Session Semantics

When delegating with `fresh: "required"`, the child agent must run in a clean session context without prior turn history.

- `fresh: "required"` guarantees context isolation only.
- It does **not** mean external audit, organizational separation, independent toolchains, or hardware attestation.
- If a contract demands independent review that the target substrate cannot truthfully enforce, Charter refuses rather than relabeling freshness as independence.

---

## 🔍 Enforcement Truth

Charter evaluates every policy dimension against the target substrate and assigns one of four strict classifications:

| Truth | Meaning |
|---|---|
| `ENFORCED` | A trusted runtime observation proves a physical substrate mechanism enforces the policy constraint. |
| `INSTRUCTED` | The policy is communicated to the model via system prompt/instructions, but no hard substrate boundary is active. |
| `UNSUPPORTED` | The target substrate cannot supply or honor the required capability. |
| `NOT_APPLICABLE` | No policy exists for this dimension on the chosen role or target. |

Rules enforced by the compiler:

- **Caller claims cannot self-attest:** An external caller or adapter cannot declare its own features as `ENFORCED`.
- **First-party Pi honesty:** The bundled Pi extension observes provider, model, and session identity directly from Pi, but does not claim hard tool ceilings or filesystem fences that Pi does not physically enforce.

---

## 📜 Authority & Scope

### Authority Binding

Authority is verifiable evidence, not an arbitrary text label.

- Root-relative path to an existing authority document (e.g. `PLAN.md`, `specs/rfc-001.md`).
- Content identity (SHA-256 hash) is bound at compilation time.
- Unreadable files, nonexistent paths, or attempts to traverse outside the workspace root (`../`) fail closed.

### Scope Confinement

- Roles with write permissions (`implement`, `correct`) **must** declare explicit path patterns (e.g. `["src/parser/**"]`).
- Read-only roles (`review`, `planner`, `adjudicate`) are restricted from code modification.
- Directory traversal, root escaping, or ambiguous paths are rejected.
- Correction roles (`correct`) are strictly bounded to explicitly accepted finding targets.

### Acceptance Truth

Charter distinguishes declared acceptance intent from executed verifier evidence:

```text
Acceptance commands   DECLARED (count) | NONE
Verifier evidence     ASSERTION_BOUND, NOT VERIFIED | UNAVAILABLE
```

Declaring `npm test` records that the command is required. It is **never** evidence that the test passed. Charter owns no post-execution test runner.

---

## 🤖 Pi-Native Operation (`charter_compile`)

### Intent Parameters

The `charter_compile` tool accepts standard bounded intent fields:

| Field | Type | Description |
|---|---|---|
| `task` | `string` | Clear, concise description of the bounded task. |
| `role` | `string` | One of `planner`, `implement`, `review`, `correct`, `adjudicate`. |
| `target` | `string` | Execution target: `parent` (current session) or `subagents` (delegation). |
| `authority` | `string` | Workspace-relative path to the governing authority document. |
| `scope` | `string[]` | Array of path globs allowed for mutation (required for write roles). |
| `fresh` | `string` | Fresh session requirement: `required` or `not_required` (subagents only). |
| `gates` | `string[]` | Optional acceptance commands (e.g. `["npm test"]`). |

### Supported Roles

| Role | Code Write | Default Focus |
|---|:---:|---|
| `planner` | ❌ | High-level planning and decomposition. |
| `implement` | ✅ | Bounded code implementation within scope. |
| `review` | ❌ | Read-only verification against authority. |
| `correct` | ✅ | Targeted fixes for accepted review findings only. |
| `adjudicate` | ❌ | Arbitrating disputed review findings. |

### Refusal & Recovery

When an intent specification violates governance, Charter responds with `REFUSED`:

```text
REFUSED: authority document 'MISSING.md' does not exist or is unreadable.
Retryable: YES (once authority document is created)
Remedy: Provide a valid workspace-relative path to an existing authority file.
```

To recover:
1. Read the refusal reason and suggested remedy.
2. Fix the underlying contract or file issue (e.g. create the authority doc, fix the path glob, or adjust the role).
3. Re-run `charter_compile`. Never attempt to bypass the compiler.

---

## 📦 TypeScript API

For embedding Charter into custom agent workflows or host environments, import from the high-level facade:

```ts
import {
  compileForTarget,
  compileDelegation,
  createAdapterIntegration,
  createAuthorityBinder,
  createEvidenceBinder,
  type TaskContract,
  type ModelProfile,
  type CompiledGovernance,
} from 'pi-charter';
```

### Core Entry Points

- **`compileForTarget(input)`**: Canonical entry point for compiling a complete `TaskContract` against target capability observations and model profiles.
- **`compileDelegation(input)`**: Compiles a bounded subagent delegation handoff without claiming child execution.
- **`createAdapterIntegration(options)`**: Integration seam for external runtimes. Reports candidate observations without granting unverified host authority.

### Returned Artifacts

A successful compilation produces a `CompiledGovernance` object with fully resolved, immutable projections:

```text
result.compiled
├── execution_contract       # Canonical resolved contract with permissions and scopes
├── target_binding           # Substrate enforcement truth table
├── rendered_role_envelope   # Bounded prompt envelope ready for agent injection
├── target_handoff           # Handoff parameters (when target is subagents)
└── resolution_receipt       # Minimal tamper-evident proof with compiler SHA-256
```

---

## ⚠️ Deliberate Boundaries

To remain simple, deterministic, and dependable, Pi Charter deliberately excludes:

- ❌ **No task or worker scheduler:** Charter does not queue tasks, spin up processes, or manage thread pools.
- ❌ **No execution handles or leases:** Charter mints no runtime tokens or stateful job IDs.
- ❌ **No retry or escalation loops:** Handling failures and retries is the orchestrator's responsibility.
- ❌ **No post-execution conformance verifier:** Charter does not parse test output or attest that code works.
- ❌ **No persistent run ledger:** Charter stores no state in SQLite, Redis, or cloud databases.
- ❌ **No automatic audit claims:** Fresh contexts are never rebranded as certified independent audits.

---

## ✅ Verification & Quality Gates

### Clean Checkout Verification

```bash
git clone https://github.com/andhikarioa/pi-charter.git
cd pi-charter
npm ci
npm run verify
```

`npm run verify` builds the package, runs TypeScript typechecks, executes the 150-test deterministic suite, and validates packed distribution contents. It owns its build prerequisites.

### Full Gate Suite

```bash
npm run verify           # Build + typecheck + 150 unit tests + dry-run pack
npm run smoke:compiler   # Tamper detection and compiler-artifact hash validation
npm run smoke:consumer   # External package consumer smoke test (isolated install)
npm run smoke:pi         # Live Pi extension loader smoke test (requires pi on PATH)
```

CI runs automatically on all pushes and pull requests via GitHub Actions (`.github/workflows/verify.yml`).

---

## 📄 Repository & License

### Active Documentation

- [`README.md`](./README.md) — Product manual, quick start, and operator guide.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Architectural mental model and protected invariants.
- [`CHANGELOG.md`](./CHANGELOG.md) — Chronological release change notes.
- `docs/archive/` — Preserved historical design and dogfooding records (not required for ordinary maintenance).

### License

[MIT](./LICENSE) © 2026 Andhika Rio
