# pi-charter

A deterministic, fail-closed governance compiler for bounded Pi work. pi-charter turns explicit authority and declarative task contracts into bounded execution truth: role and model routing, authority binding, scope narrowing, execution-target capability truth, role instructions, and bounded next actions.

> 🛡️ **Fail-Closed Governance:** *Charter decides, constrains, and compiles. The substrate executes.* An unstaffable model tier, unverifiable authority, or contradictory contract stops immediately.

**Current release: v0.1.2** — sealed, locally packaged, and dogfood validated. Built for Pi operators and coding agent harnesses that need rigorous boundaries, honest target enforcement, and independent review verification.

```text
validate contract → bind authority → resolve model/scope → bind target capability → compile role envelope → emit receipt
```

## Contents

- [🚀 Quick Start](#-quick-start)
- [🛡️ Safety Model](#️-safety-model)
- [🏛️ Governance Pipeline](#️-governance-pipeline)
- [🎭 Canonical Roles](#-canonical-roles)
- [🎯 Execution Targets & Capabilities](#-execution-targets--capabilities)
- [🔌 Companion Extension & Tools](#-companion-extension--tools)
- [🤖 Operate with Pi Agent](#-operate-with-pi-agent)
- [🚦 Bounded Next Actions](#-bounded-next-actions)
- [🧾 Resolution Receipts & Verification](#-resolution-receipts--verification)
- [📦 Programmatic SDK (TypeScript)](#-programmatic-sdk-typescript)
- [⚠️ Unsupported / UNKNOWN / Deferred](#️-unsupported--unknown--deferred)
- [📋 Common Operator Workflows](#-common-operator-workflows)
- [♻️ Refusal Recovery & Remediation](#️-refusal-recovery--remediation)
- [🛠️ Verification & Development](#️-verification--development)
- [📦 Release](#-release)

## 🚀 Quick Start

pi-charter exposes two first-class interfaces: native Pi Agent tools (`charter_compile`, `charter_verify_execution`) and a strongly-typed TypeScript SDK (`pi-charter`).

### 1. Pi Agent Native Path (Recommended)

When working inside Pi, the bundled extension registers `charter_compile`. No hand-authored JSON is needed — state the intent directly:

```yaml
# Inside your prompt or agent turn:
task: implement JSON store persistence
role: implement
target: subagents
authority: CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md
scope: [internal/store/**]
fresh: required
gates: [go test ./internal/store/..., go vet ./internal/store/...]
```

```text
charter_compile({
  task: "implement JSON store persistence",
  role: "implement",
  target: "subagents",
  authority: "CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md",
  scope: ["internal/store/**"],
  fresh: "required",
  gates: ["go test ./internal/store/...", "go vet ./internal/store/..."]
})
```

#### Read the Result as Four Separate Truths

Every compile returns four distinct truths. Never confuse delegation readiness with child execution proof:

| Dimension | `target: parent` | `target: subagents` |
| --- | --- | --- |
| **Authority** | `BOUND` | `BOUND` |
| **Handoff** | Not applicable (runs in this session) | `HANDOFF_READY` |
| **Runtime Attestation** | `YES` (observed active session) | `NO` (this process does not observe the child) |
| **Execution Proof** | `AVAILABLE` upon observed execution | `UNAVAILABLE` (child runtime unobserved) |

For `target: parent`, compile admits the artifact set and returns an opaque `execution_handle`. Once the work runs, verify execution conformance:

```text
charter_verify_execution({ execution_handle: "<EXECUTION_HANDLE>" })
```

### 2. Local TypeScript Dependency Path

`pi-charter` is a private, compiled package (`"private": true` in `package.json`). Consume it as a local path dependency:

```bash
cd pi-charter && npm install && npm run build
```

```json
{
  "dependencies": {
    "pi-charter": "file:../pi-charter"
  }
}
```

```ts
import { compileForTarget, createAuthorityBinder } from 'pi-charter';

const authority_binder = createAuthorityBinder({
  'spec-doc': { path: 'docs/SPEC.md' },
});

const result = compileForTarget({
  task_contract: contract,
  authority_binder,
  model_profile,
  available: ['claude-3-7-sonnet', 'gpt-4o', 'o3-mini'],
  capability_claim: {
    name: 'parent',
    capabilities: {
      model_selection: true,
      fresh_session: false,
      tool_ceiling: false,
      file_scope_enforcement: false,
      independent_review: false,
    },
  },
});
```

## 🛡️ Safety Model

CAN DO != MAY DO: pi-charter only compiles explicitly admitted work under verified authority. Contradictory, overbroad, or unverifiable contracts fail closed.

| Invariant | What it means for you |
| --- | --- |
| **Explicit authority** | Authority must resolve uniquely to a real document. Charter never chooses a "close enough" document. |
| **Monotonic narrowing** | Resolution only narrows scope, authority, or permissions; it never broadens them. |
| **Explicit model fallback** | Fallbacks must be declared in the profile. Silent model substitution is prohibited. |
| **Fail closed** | Missing authority, unstaffable tiers, or conflicting permissions halt resolution immediately. |
| **Truthful enforcement** | `ENFORCED`, `INSTRUCTED`, `UNSUPPORTED`, and `NOT_APPLICABLE` stay distinct. |
| **Attested or claimed** | Raw caller claims can never produce `ENFORCED` capability or attested model truth. |
| **Resolved evidence** | Authority, assertions, and correction targets carry content digests and binding identities. |
| **Execution stays external** | Charter never spawns, supervises, recovers, or schedules worker processes. |
| **Bounded escalation** | Charter decides exactly one deterministic next action; it does not loop autonomously. |
| **Separation of truths** | A delegation compile returns `HANDOFF_READY` without claiming child runtime attestation or minting a child execution handle. |

### Enforcement Truth Table

Constraints in the target binding map strictly to one of four statuses:

- `ENFORCED`: The substrate provides a verified hard primitive AND the contract declares an applicable policy (e.g., exact `scope.files` or `execution_policy.allowed_tools`) AND the capability is **attested**, not claimed.
- `INSTRUCTED`: A policy applies, but the target cannot hard-enforce it (or the capability is only claimed).
- `UNSUPPORTED`: Selected target cannot satisfy a required constraint.
- `NOT_APPLICABLE`: No policy declared for this dimension (not a softer `ENFORCED`, and not "all allowed").

> ⚠️ **Critical Rule:** `INSTRUCTED != ENFORCED`. Charter never misrepresents prompt instructions as sandbox enforcement. A boolean flag passed by a caller remains an unattested claim.

## 🏛️ Governance Pipeline

Charter transforms declarative governance into actionable instruction artifacts and structured decisions:

```text
TaskContract
    ↓
validate + bind authority (fail-closed)
    ↓
deterministic resolution → ExecutionContract (model, jurisdiction, narrowed scope)
    ↓
execution-target capability truth → TargetBinding
    ↓
compile → RoleEnvelope (instructions, prohibitions, stop conditions)
    ↓
executor acts outside Charter (parent or delegated child)
    ↓
explicit outcome + evidence
    ↓
bounded next-action decision (decideNextAction)
```

1. **Validate & Bind Authority**: Confirms contract schema and verifies that declared authority references resolve to unambiguous sources.
2. **Deterministic Resolution**: Routes the role to an admitted model tier, validates tier availability, establishes jurisdiction, and monotonically narrows permissions.
3. **Target Capability Binding**: Evaluates target capabilities (`parent` or `subagents`) against required constraints, producing an immutable `EnforcementTruthTable`.
4. **RoleEnvelope Compilation**: Compiles role-specific instructions: exact permitted actions, explicit prohibitions, and mandatory stop conditions.
5. **Bounded Next-Action Decision**: Evaluates post-execution outcome evidence against declared limits to return a single deterministic next action.

## 🎭 Canonical Roles

Charter defines exactly five canonical governance roles:

| Role | Purpose | Strict Boundary |
| --- | --- | --- |
| `planner` | Decomposes admitted work into bounded units | Decomposition only; no code write, external write, or architecture redesign. |
| `implement` | Implements bounded tasks under frozen semantics | Bounded implementation; no speculative refactoring or unreviewed scope expansion. |
| `review` | Performs conformance review against acceptance criteria | Read-only conformance review; cannot modify code or perform unbounded audits. |
| `correct` | Applies fixes for named, already-accepted findings | Only named accepted correction targets; cannot reopen review or invent fixes. |
| `adjudicate` | Resolves one contradiction in semantics, authority, or contract | Resolves one bounded contradiction; routes to reasoning tier; no implementation authority. |

Role defines governance jurisdiction, not model names. Model tiers (`workhorse`, `reviewer`, `reasoning`) are resolved separately by the compiler based on role and profile.

### Bounded Correction Authority (`role: correct`)

The `correct` role requires two explicit evidence links for each target:
1. **Finding link:** The exact finding identifier (e.g. `review-finding:P1`).
2. **Acceptance link:** The explicit owner acceptance of that finding.

A blocker identifier alone admits nothing. Missing or ambiguous links fail closed.

## 🎯 Execution Targets & Capabilities

Charter supports two canonical execution targets:

### 1. `parent`
The active Pi session acts as the executor. This is a first-class execution target:
- Admitted artifact set produces an `execution_handle`.
- Observed tool calls in the active session provide execution proof.
- Cannot satisfy independent review requirements (cannot review itself independently).

### 2. `subagents`
A thin handoff target for delegated child execution:
- Translates resolved truth into bounded delegation parameters (`model`, `fresh_session_required`, `enforcement`).
- Compiles to `HANDOFF_READY`.
- Truthfully reports `runtime_attested: false` and `execution_proof: UNAVAILABLE`.
- Mints **no execution handle** (this process does not observe the child runtime).

```text
Authority       BOUND
Handoff         HANDOFF_READY
Runtime proof   UNAVAILABLE
Execution proof UNAVAILABLE
routing         REQUIREMENT_ONLY
fresh           REQUIRED | NOT_REQUIRED
capability      unattested_claim
```

## 🔌 Companion Extension & Tools

pi-charter bundles a Pi extension and companion skill (`skills/pi-charter/`):

| Tool | Purpose | Key Invariant |
| --- | --- | --- |
| `charter_compile` | Compiles bounded governance from simple intent or canonical contract | Admitted artifact set for `parent` receives `execution_handle`; `subagents` receives `HANDOFF_READY` handoff. |
| `charter_verify_execution` | Verifies observed tool run against parent admission handle | Refused if session never executed work, or if passed an unadmitted artifact. |

### Archaeology Off by Default

Operators and agents should state intent directly. Do not inspect compiler sources, declarations, or internal functions before compiling:

```text
ARCHAEOLOGY: OFF by default

NO Charter source reads before the first compile
NO dist/ or .d.ts inspection to find out how to call the tool
NO hand-authored TaskContract JSON for normal work
```

A reference may be consulted only after an explicit, evidenced blocker.

## 🤖 Operate with Pi Agent

When working with Pi, Charter provides deterministic governance boundaries for multi-turn tasks:

```text
You ──(normal intent)──▶ Pi Agent
                           │
                           ├── charter_compile (validates authority, scope, gates)
                           │
                           ▼
                  Governed Execution
                  (Parent or Delegated Child)
                           │
                           ▼
                  charter_verify_execution
                  (Verifies conformance against admission)
```

| What you want to do | How to ask Pi |
| --- | --- |
| Implement a bounded slice | `"Use charter to implement internal/store/** under BUILD-PLAN.md, gate with go test."` |
| Delegate independent review | `"Compile a review contract for subagents requiring fresh independent session."` |
| Correct an accepted bug | `"Run charter_compile role: correct for finding P1 accepted by owner."` |
| Adjudicate a spec conflict | `"Adjudicate contradiction between section 2 and section 4 under reasoning tier."` |

## 🚦 Bounded Next Actions

`decideNextAction()` is a pure decision function that evaluates post-execution evidence against contract limits:

```ts
import { decideNextAction } from 'pi-charter';

const decision = decideNextAction({
  role_envelope: compiledEnvelope,
  outcome: 'MECHANICAL_FAILURE',
  counters: {
    clean_retries_used: 0,
    correction_rounds_used: 0,
    semantic_escalations_used: 0,
  },
});
```

### Outcome Vocabulary & Deterministic Mapping

| Outcome | Mapped Next Action | Behavior |
| --- | --- | --- |
| `SUCCESS` | `PASS` | Work completed successfully; terminal. |
| `MECHANICAL_FAILURE` (retries < limit) | `RETRY_SAME_ROLE` | Exactly one clean retry allowed. |
| `MECHANICAL_FAILURE` (retries ≥ limit) | `HUMAN_DECISION_REQUIRED` | Halts autonomous loop; escalates to operator. |
| `SEMANTIC_AMBIGUITY` | `ADJUDICATE` | Routes to adjudicator role. |
| `AUTHORITY_CONTRADICTION` | `ADJUDICATE` | Routes to adjudicator role. |
| `ARCHITECTURE_CONTRADICTION` | `HUMAN_DECISION_REQUIRED` | Immediate halt; requires human decision. |
| `MODEL_UNAVAILABLE` | `STOP_MODEL_UNAVAILABLE` | Unstaffable tier; halts execution. |
| `EXECUTION_TARGET_UNSUPPORTED` | `STOP_UNSUPPORTED_BY_EXECUTION_TARGET` | Missing hard primitive; halts execution. |
| `ADJUDICATION_RESOLVED` | `DE_ESCALATE_TO_ROLE` | Returns to explicitly designated downstream role. |
| `ADJUDICATION_UNRESOLVED` | `HUMAN_DECISION_REQUIRED` | Halts loop; no automatic re-adjudication. |

> 🛡️ **Boundary:** Charter returns the decision. It never executes the retry, spawns the adjudicator, or loops autonomously.

## 🧾 Resolution Receipts & Verification

For auditability, Charter emits deterministic resolution receipts committed to the compiler build identity:

```ts
import { createEvidenceBinder, createResolutionReceipt } from 'pi-charter';

const receipt = createResolutionReceipt({
  task_contract: contract,
  authority_binder: authorityBinder,
  assertion_binder: assertionBinder,
  model_profile: profile,
  available: available,
  capability_claim: capabilityClaim,
  compiler_identity: compilerIdentity, // sha256:<digest> over dist/ runtime artifacts
  target_binding: binding.binding,
});
```

### Execution Conformance Verification

Receipt proves what was **compiled**; execution attestation proves what **ran**:

```text
Charter compiles governance → substrate executes → substrate emits execution evidence → Charter verifies conformance
```

```ts
import { verifyExecutionAttestation } from 'pi-charter';

const verification = verifyExecutionAttestation({
  execution_attestation,
  resolution_receipt: compiled.compiled.resolution_receipt,
  role_envelope: compiled.compiled.role_envelope,
  execution_contract: compiled.compiled.execution_contract,
});
```

Verification outcomes:
- `EXECUTION_CONFORMANT`
- `NON_CONFORMANT` (with exact deviation codes: `MODEL_MISMATCH`, `EXECUTION_TARGET_MISMATCH`, `RESOLUTION_RECEIPT_MISMATCH`, `FRESH_SESSION_NOT_EVIDENCED`, `TOOL_POLICY_VIOLATION`, `UNTRUSTED_EXECUTION_EVIDENCE`).

## 📦 Programmatic SDK (TypeScript)

The package root exposes the complete programmatic API:

```ts
import {
  compileForTarget,
  compileViaPi,
  observeExecutionViaPi,
  verifyExecutionViaPi,
  decideNextAction,
  createAuthorityBinder,
  createEvidenceBinder,
  createResolutionReceipt,
  verifyExecutionAttestation,
  type TaskContract,
  type ModelProfile,
  type EnforcementTruthTable,
} from 'pi-charter';
```

Only the package root is a supported export path. Internal modules (trust minters, evidence issuers) are private by construction.

## ⚠️ Unsupported / UNKNOWN / Deferred

- **UNSUPPORTED** ❌: Outside the Charter contract.
  - Task schedulers, job queues, worker pools, or process managers.
  - Automatic test loops or unsupervised execution runners.
  - Runtime lease managers, distributed locks, or session recovery databases.
  - Ambient filesystem crawling or automatic authority discovery.
- **UNKNOWN** ❓: Cannot be proven from current evidence.
  - Unobserved child subagent runtime capabilities.
  - Unverified caller capability claims (treated as claimed, never `ENFORCED`).
- **DEFERRED** ⏳: Post-v0.1 milestones.
  - Multi-session distributed attestation protocols.

## 📋 Common Operator Workflows

| Goal | Flow |
| --- | --- |
| **Bounded parent implementation** | Intent (`role: implement`, `target: parent`) → `charter_compile` → execute → `charter_verify_execution` |
| **Delegated independent review** | Intent (`role: review`, `target: subagents`, `fresh: required`) → `charter_compile` → `HANDOFF_READY` handoff |
| **Named bug correction** | Intent (`role: correct`, finding + acceptance links) → `charter_compile` → bounded fix → rereview |
| **Contract contradiction** | Compilation refusal → inspect structured error → resolve conflict at authority source |
| **Mechanical failure retry** | Test failure → `decideNextAction(outcome: MECHANICAL_FAILURE)` → `RETRY_SAME_ROLE` (max 1 retry) |

## ♻️ Refusal Recovery & Remediation

| Refusal Code | Cause | Remediation |
| --- | --- | --- |
| `AUTHORITY_UNRESOLVED` | Document not found or path escapes root | Provide exact relative path within workspace root |
| `MODEL_UNAVAILABLE` | Declared tier models are unstaffable | Declare valid fallback in model profile; never silently substitute |
| `UNSUPPORTED_BY_EXECUTION_TARGET` | Target lacks required hard primitive | Do not demand hard enforcement if substrate cannot enforce it |
| `CONTRACT_CONTRADICTION` | Mutually exclusive fields (e.g. read-only role with `code_write: true`) | Align role permissions with task requirements |
| `HUMAN_DECISION_REQUIRED` | Correction budget or retry limits exhausted | Stop autonomous progression; present choices to human operator |
| `COMPILER_IDENTITY_MISMATCH` | Compiled `dist/` runtime differs from recorded identity | Run `npm run build` to synchronize build identity |

## 🛠️ Verification & Development

Maintainers can verify the package using standard npm scripts:

```bash
# Typecheck TypeScript sources
npm run typecheck

# Run test suite (compiles to dist/ and runs JavaScript tests)
npm test

# Build package and record build identity
npm run build

# Run typecheck, tests, and dry-run pack
npm run verify

# Integration smoke tests
npm run smoke:compiler   # Tamper runtime artifact copy: verifies identity mismatch & rebuild
npm run smoke:pi         # Verifies Pi extension tool discovery and compile/verify paths
npm run smoke:consumer   # Packs tarball, installs in isolated consumer, verifies compilation
```

**Test Suite Baseline:** 308 tests, **308 PASS**.

## 📦 Release

**Current Release: v0.1.2 (Sealed & Immutable)**

- **Version:** `0.1.2`
- **Annotated tag:** `v0.1.2` — the tag points at the seal commit (`git rev-list -n1 v0.1.2`)
- **Release-prep baseline:** `44e5fb53be2ebbd98c87e8c7b43942de7b4f4612`
- **Previous release:** v0.1.1 — `5c2ccd2149a1f7c08bafa8b71951f88a4e2d7769` (tag `v0.1.1`)
- **Dogfood closeout:** `6bc1b8c099298d8ce13865e6b15654cedfd8177c` — [`PI-CHARTER-V0.1.2-TASKLET-DOGFOOD-CLOSEOUT.md`](./PI-CHARTER-V0.1.2-TASKLET-DOGFOOD-CLOSEOUT.md)
- **Tasklet dogfood final HEAD:** `1651ca68d35c9382095ed74ecf07907d21096c0c`
- **Specification:** [`PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md`](./PI-CHARTER-v0.1-CANONICAL-MASTER-BUILD-SPEC.md)

Accepted release delta:

- simplified one-call Pi-native operator compile UX
- bounded subagent delegation handoff
- explicit weaker runtime/execution truth
- compatibility preservation for v0.1.1 advanced authority input
- freshness contradiction closure
- authority-path symlink containment closure
- native correction-authority input for `role=correct`
- fail-closed correction provenance
- Tasklet dogfood PASS / CLOSED

Sealing is a commit, an annotated tag, and a push. This package is private: no registry publish was
performed, and no GitHub Release was created.

v0.1.2 does **not** claim child execution attestation by Charter, universal verifier-attested
acceptance, runtime/scheduler ownership, or cross-runtime lifecycle ownership.

### Previous Release: v0.1.1 (Sealed & Immutable)

- **Sealed commit:** `5c2ccd2149a1f7c08bafa8b71951f88a4e2d7769`
- **Annotated tag:** `v0.1.1`
- **Dogfood validation:** Real-world build validation against `tasklet` (local Go CLI with JSON persistence) covering parent implementation, delegated child work, independent review, owner adjudication, and bounded correction.
