# pi-charter

A deterministic, fail-closed governance compiler for bounded Pi work.

pi-charter turns an explicit `TaskContract` into bounded execution truth: role and model routing, authority, scope, permissions, execution-target capability truth, role instructions, and bounded next actions.

It decides, constrains, and compiles. The execution substrate executes.

pi-charter is **not** a scheduler, worker runtime, session manager, workflow engine, or recovery engine.

```text
Current release: v0.1
Status: sealed
Core: closed
Companion skill: bundled
```

---

## 🚀 Quick Start

### Installation & Repository Setup

`pi-charter` is a private, compiled package in this repository (`"private": true` in `package.json`), not published to the public npm registry. It ships `dist/` JavaScript plus type declarations, declares its supported Node runtime through `engines` (`>=22.0.0`), and exposes one entry point — the package root. No absolute source path and no `--experimental-strip-types` are involved in consuming it. To build and consume it locally:

```bash
# Clone the repository
git clone <repo-url> pi-charter
cd pi-charter

# Install dependencies and verify
npm install
npm run verify
```

To consume `pi-charter` in another local project, configure it as a local path dependency and build it once:

```bash
cd ../pi-charter && npm run build   # emits dist/ and records the build identity
```

```json
{
  "dependencies": {
    "pi-charter": "file:../pi-charter"
  }
}
```

```ts
import { compileForTarget, verifyExecutionAttestation } from 'pi-charter';
```

Internal modules (the trust-boundary minter, the execution-evidence issuer, the canonical binding
provenance store) are deliberately **not** exported. Only the package root is a supported import path.

### Minimal Usage Flow

Author a `TaskContract`, then compile it with the one blessed facade. `compileForTarget` owns the
canonical order — resolve → bind → compile envelope → render → hand off → receipt — so a caller never
composes the pipeline from memory:

```ts
import {
  compileForTarget,
  createAuthorityBinder,
  createEvidenceBinder,
  type ModelProfile,
  type TaskContract,
} from 'pi-charter';

// 1. Author a bounded TaskContract
const contract: TaskContract = {
  version: 'charter/v0.1',
  task: { id: 'fix-parser-bounds', class: 'T2', risk: 'medium' },
  role: 'implement',
  execution_target: 'parent',
  root: '/absolute/project/root',
  authority: { sources: ['spec-doc'] },
  scope: { files: ['src/parser.ts'] },
  permissions: { code_write: true, research: false, external_write: false, release: false },
  acceptance: { commands: ['npm test'] },
  verification: { level: 'V2' },
  limits: { correction_rounds: 1 },
  non_goals: ['refactoring ast types'],
};

// 2. Explicit environment inputs: authority evidence, model profile, model availability
const authority_binder = createAuthorityBinder({
  'spec-doc': { path: 'docs/SPEC.md' },
});

const model_profile: ModelProfile = {
  workhorse: { preferred: 'claude-3-7-sonnet', fallback: ['claude-3-5-sonnet'] },
  reviewer: { preferred: 'gpt-4o', fallback: [] },
  reasoning: { preferred: 'o3-mini', fallback: [] },
};

const result = compileForTarget({
  task_contract: contract,
  authority_binder,
  model_profile,
  // A raw list is a CLAIM: it is recorded as one and can never ground attested registry truth.
  // The strong channel is `model_availability_attestation` plus a trusted `AttestationVerifier`.
  available: ['claude-3-7-sonnet', 'gpt-4o', 'o3-mini'],
  // Same rule for target capabilities: `capability_claim` is a claim and can never produce ENFORCED.
  // `capability_attestation` + `capability_attestation_verifier` is the attested channel.
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

if (!result.ok) {
  console.error('Compilation refused:', result.errors);
  process.exitCode = 1;
  throw new Error('Compilation failed closed');
}

const {
  execution_contract,      // Phase 2: what was resolved
  target_binding,          // Phase 3: what the target can actually enforce, and on what evidence
  role_envelope,           // Phase 4: the instruction artifact
  rendered_role_envelope,  // Phase 4: that artifact as deterministic prompt text
  target_handoff,          // the target adapter's handoff — a separate artifact, never an envelope input
  resolution_receipt,      // Phase 5: the evidence of this compilation, with the real build identity
} = result.compiled;

console.log(rendered_role_envelope);
```

Why the facade and not the five low-level calls: `target_binding` is the only value that carries
canonical process-local binding provenance, and it is the only value `compileBoundRoleEnvelope`
accepts. A hand-built, copied, cloned, or JSON-roundtripped binding compiles **nothing** — that is
the composition mistake the facade exists to make unreachable. Low-level functions remain public for
advanced and internal use; see the companion skill's `library-usage` reference.

From Pi itself, prefer the bundled Pi integration. Pi discovers the package's extension and exposes
two tools — `charter_compile` and `charter_verify_execution` — that observe the live session and hand
out no trust to the caller. The library bridge below does the same thing when you are already writing
TypeScript inside the Pi process; `compileDelegation` compiles bounded delegation authority for a
subagents target without claiming anything about a child runtime:

```ts
import { compileViaPi, observeExecutionViaPi, verifyExecutionViaPi } from 'pi-charter';

const compiled = compileViaPi({ task_contract: contract, authority_binder, model_profile });
if (!compiled.ok) throw new Error('Compilation refused');

// … the session runs the work …

// The compile ADMITS exactly this artifact set for execution and returns the handle that proves it,
// and the runtime reports the execution it actually observed. Admission alone is not execution: a
// handle with no observed execution does not verify. Artifacts supplied at verification time are
// checked against the admission, never promoted into execution evidence.
observeExecutionViaPi({ execution_handle: compiled.execution_handle });
const verified = verifyExecutionViaPi({
  execution_handle: compiled.execution_handle,
  resolution_receipt: compiled.compiled.resolution_receipt,
  role_envelope: compiled.compiled.role_envelope,
  execution_contract: compiled.compiled.execution_contract,
});
```

### Fail-Closed Principle

When resolution or target binding returns `!ok`, stop. Inspect the structured errors:

```ts
const result = compileForTarget({ task_contract: contract, authority_binder, model_profile, available });
if (!result.ok) {
  console.error(result.errors); // exact code + path + message, never a heuristic
  process.exitCode = 1;
  return;
}
```

Charter enforces fail-closed behavior. Never weaken permissions or broaden scope in a loop to force a contract through. A refusal signals missing authority, unstaffable model tiers, or conflicting constraints that must be resolved at their source.

---

## 🧭 What Charter Does

Charter transforms declarative governance into actionable instruction artifacts and structured decisions:

```text
TaskContract
    ↓
validate + bind authority
    ↓
deterministic resolution
    ↓
ExecutionContract
    ↓
execution-target capability truth
    ↓
TargetBinding
    ↓
RoleEnvelope
    ↓
executor acts outside Charter
    ↓
explicit result
    ↓
bounded next-action decision
```

1. **Validate & Bind Authority**: Confirms contract schema and verifies that every declared authority reference maps to an exact, unambiguous source.
2. **Deterministic Resolution**: Routes the role to an admitted model tier, validates tier availability, establishes jurisdiction, and monotonically narrows scope and permissions.
3. **Execution-Target Binding**: Evaluates target capabilities (`parent` or `subagents`) against required constraints, producing an immutable `EnforcementTruthTable`.
4. **RoleEnvelope Compilation**: Compiles role-specific instructions: exact permitted actions, explicit prohibitions, and mandatory stop conditions.
5. **Bounded Next-Action Decision**: Evaluates post-execution outcome evidence against declared limits to return a single deterministic next-action decision.

---

## 🛡️ Safety Model

Charter enforces seven core invariants across the compilation pipeline:

| Invariant | Meaning |
| :--- | :--- |
| **Explicit authority** | Authority must resolve uniquely; Charter does not choose the closest authority source. |
| **Monotonic narrowing** | Resolution may narrow authority; never broaden it. |
| **Explicit model fallback** | Fallbacks must be declared in the profile; no silent substitution. |
| **Fail closed** | Contradictory or unsupported work stops. |
| **Truthful enforcement** | `ENFORCED`, `INSTRUCTED`, `UNSUPPORTED`, and `NOT_APPLICABLE` stay distinct. |
| **Attested or claimed** | Attested environment truth and raw caller claims never share proof vocabulary. |
| **Resolved evidence** | Authority, assertions, and correction targets carry binding identity plus content digest. |
| **Execution stays external** | Charter does not spawn/manage/recover workers. |
| **Bounded escalation** | Charter decides one next action; it does not execute the loop. |

### Enforcement Truth

Constraints in the target binding map strictly to one of four statuses:

- `ENFORCED`: The substrate has a real hard primitive AND the contract declares an applicable policy
  (exact non-empty `scope.files` for `allowed_files`, `execution_policy.allowed_tools` for
  `allowed_tools`) AND the capability is ATTESTED, not merely claimed.
- `INSTRUCTED`: A policy applies, but the target cannot hard-enforce it (or nothing attests it).
- `UNSUPPORTED`: Selected target cannot satisfy the requirement.
- `NOT_APPLICABLE`: This contract declares no policy for that dimension, so there is nothing to
  enforce and nothing to instruct. This is not a softer `ENFORCED`, and it is not "all tools allowed".

> **Critical Rule**: `INSTRUCTED != ENFORCED`. Charter never misrepresents prompt instructions as
> sandbox enforcement, never reports `ENFORCED` from a caller-supplied boolean, and never reports
> `ENFORCED` where a capability exists but no policy says what to enforce.

### Refusal Behavior

When Charter refuses a contract, inspect the error code and correct the source:

| Error Code | Meaning & Remediation |
| :--- | :--- |
| `AUTHORITY_UNRESOLVED` | Provide explicit authority; do not choose a "close enough" source. |
| `MODEL_UNAVAILABLE` | Only declared fallback may be used; unstaffable tiers halt resolution. |
| `UNSUPPORTED_BY_EXECUTION_TARGET` | Target lacks required primitive; do not pretend soft instruction is hard enforcement. |
| `CONTRACT_CONTRADICTION` | Resolve conflicting fields explicitly (e.g. read-only role requesting `code_write`). |
| `HUMAN_DECISION_REQUIRED` | Escalation or correction limits exhausted; stop autonomous progression. |

---

## 👥 Roles

Charter defines exactly five canonical roles for v0.1:

| Role | Purpose | Strict Boundary |
| :--- | :--- | :--- |
| `planner` | Decomposes admitted work into bounded units | Decomposes admitted work; no implementation or architecture redesign. |
| `implement` | Implements bounded tasks under frozen semantics | Bounded implementation under frozen semantics; no speculative refactoring. |
| `review` | Performs conformance review against acceptance criteria | Read-only bounded conformance review; cannot modify code or perform broad audits. |
| `correct` | Applies fixes for named, already-accepted findings | Only named accepted correction targets; cannot reopen review or invent fixes. |
| `adjudicate` | Resolves one contradiction in semantics, authority, or contract | One bounded semantic/authority/contract contradiction; no implementation authority. |

Role defines governance jurisdiction. It is not a model name and not a permission grant. Model tiers (`workhorse`, `reviewer`, `reasoning`) are resolved separately by the compiler based on the role and model profile.

---

## 🎯 Execution Targets

Charter supports exactly two execution targets in v0.1:

### `parent`
The current parent Pi session acts as the executor. This is a first-class execution target—subagents and multi-session tools are not required.

### `subagents`
A thin handoff target for delegated execution. Charter translates resolved truth into bounded handoff parameters (`model`, `fresh_session_required`, `enforcement`). `fresh_session_required` and the delegation handoff's `fresh_context` are one dispatch freshness truth — the operator's requirement OR the contract's out-of-session review requirement — so they never contradict.

Charter itself does **not**:
- spawn or terminate child sessions;
- supervise or monitor worker processes;
- manage locks, leases, or worker pools;
- track task progress or handle retries.

Hard enforcement depends on the selected target's actual **capability evidence**, never on the target
name. `parent` and `subagents` are execution targets, not permanent capability guarantees; a claim
about a capability is recorded as a claim and can never produce `ENFORCED`.

### Review Independence

Review independence is bounded by target capability truth:
- **Same-session review**: A `parent` session cannot claim independent review.
- **Fresh independent review**: Only admitted when target capability truth proves that a fresh, isolated session is supported and requested.

### Common Workflows

| Workflow | Role & Target | Key Constraints |
| :--- | :--- | :--- |
| **Bounded implementation** | `implement` / `parent` | Exact `scope.files`, `code_write: true`, non-independent review. |
| **Independent review** | `review` / `subagents` | Read-only permissions, requires `fresh_session` and `independent_review` capabilities. |
| **Named correction** | `correct` / `parent` | `correct` may modify only named accepted correction targets in `scope.blockers`; bound authority sources ground those targets but are not themselves findings. |
| **Semantic adjudication** | `adjudicate` / `parent` | Solves one semantic or contract conflict; routes to `reasoning` tier. |
| **Enforcement refusal** | Any | Contract requiring hard enforcement unsupported by the target's capability evidence fails with `UNSUPPORTED_BY_EXECUTION_TARGET`. |

---

## 📦 Companion Skill

`pi-charter` bundles an operator companion skill located in `skills/pi-charter/` and registered in `package.json`:

```json
{
  "pi": {
    "extensions": [
      "./extensions"
    ],
    "skills": [
      "./skills"
    ]
  }
}
```

The bundled extension is the Pi-native surface: Pi loads it, and it registers `charter_compile` and
`charter_verify_execution`. `charter_compile` takes normal operator intent (task, role, target,
authority document, scope, fresh, gates) and normalizes it into the strict canonical contract — or an
advanced `task_contract` + `authority_evidence` (the sealed v0.1.1 `task_contract` + `authority`
evidence object remains accepted). For `target=parent` it admits the exact artifact set
and returns the execution handle; for `target=subagents` it compiles bounded delegation authority and
returns a `HANDOFF_READY` handoff with the weaker truth stated plainly (`runtime_attested: false`,
`execution_proof: UNAVAILABLE`, `routing.truth: REQUIREMENT_ONLY`, no capability attested, no execution
handle). `charter_verify_execution` verifies an OBSERVED run of this session against a parent
admission only — Pi reports every tool execution in the session, and that observation is what makes
the admitted artifact set a run. Neither tool accepts capability booleans, a model inventory, a trust
boundary, or a caller-chosen compiler identity, and neither can mint trust.

The companion skill provides operator and agent adoption guidance:
- When to apply Charter governance to non-trivial tasks.
- How to state normal intent and compile it with one tool call, with archaeology off by default.
- How to read a result's four truths: authority, handoff, runtime attestation, execution proof.
- How to interpret compiler refusals, retryability, and remedies.
- How to consume compiled `RoleEnvelope` instructions.

The skill is tool-first: `charter_compile` is the authoring and compile surface, and bundled
references are for interpreting a result or resolving an evidenced blocker — not for archaeology
before the first call. Source and declarations are dropped into only for an evidenced gap or explicit
API/source verification. Shipped implementation remains the higher authority.

> **Key Rule**: The skill does not broaden what core permits. Core Charter remains the sole deterministic governance authority.

*(Note: `pi-intercom` is optional. It may be used if inter-session messaging is needed in your environment, but Charter core has no dependency on it.)*

---

## 🔀 Bounded Next Actions

Charter provides `decideNextAction()`, a pure decision function that evaluates post-execution evidence against contract limits:

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

### Outcome Vocabulary
- `SUCCESS`, `MECHANICAL_FAILURE`, `SEMANTIC_AMBIGUITY`, `AUTHORITY_CONTRADICTION`, `ARCHITECTURE_CONTRADICTION`, `MODEL_UNAVAILABLE`, `EXECUTION_TARGET_UNSUPPORTED`, `ADJUDICATION_RESOLVED`, `ADJUDICATION_UNRESOLVED`.

### Next Actions
- `PASS`: Work completed successfully; terminal.
- `RETRY_SAME_ROLE`: Exactly one clean retry allowed for mechanical failures.
- `ADJUDICATE`: Route semantic ambiguity or authority contradiction to an adjudicator.
- `DE_ESCALATE_TO_ROLE`: Return to an explicitly designated downstream role after adjudication.
- `HUMAN_DECISION_REQUIRED`: Limits exhausted or architectural contradiction; halts autonomous loops.
- `STOP_MODEL_UNAVAILABLE`: Required model cannot be staffed; halts execution.
- `STOP_UNSUPPORTED_BY_EXECUTION_TARGET`: Target lacks required primitive; halts execution.

> **Boundary**: Charter returns the decision. It does not perform the retry, adjudication, correction, or human escalation.

---

## 🧾 Resolution Receipts

For audit and verification records, Charter can emit deterministic resolution receipts:

```ts
import { createEvidenceBinder, createResolutionReceipt } from 'pi-charter';

// Resolves each declared assertion to exactly one verifier identity; an unbound assertion fails closed.
const assertionBinder = createEvidenceBinder({ 'p7-no-blind-replay': 'go-test:TestP7NoBlindReplay' });

const receipt = createResolutionReceipt({
  task_contract: contract,
  authority_binder: authorityBinder,
  assertion_binder: assertionBinder, // required when the contract declares assertions
  model_profile: profile,
  available: available, // raw availability CLAIM; `model_availability_attestation` + a verifier is the strong channel
  capability_claim: capabilityClaim,
  // Identity of the compiler artifact that ran this resolution. `compileForTarget` supplies this for
  // you: it is `sha256:<digest>` over the compiled `dist/` artifact set that `npm run build` emitted,
  // so the same build always has the same identity and a changed artifact always has a different one.
  // A missing or version-shaped value produces no receipt, and no identity is ever fabricated.
  compiler_identity: compilerIdentity,
  target_binding: binding.binding,
});
```

Receipt properties:
- **Evidence-Only**: Emitted only when input evidence coherence is verified against the canonical pipeline.
- **Deterministic**: Every identity is a SHA-256 hash over canonically serialized evidence.
- **No Persistence**: Receipts are not workflow state, run history, or resumption tokens. Charter does not store or manage them.

### Receipt ≠ Execution Attestation

A receipt proves what was **compiled**. It says nothing about what actually ran, because Charter
executes nothing. Execution evidence is a separate artifact, and it comes from the substrate:

```text
Charter compiles governance  →  the substrate executes  →  the substrate emits execution evidence
                                                            →  Charter verifies conformance
```

```ts
import { verifyExecutionAttestation } from 'pi-charter';

const verification = verifyExecutionAttestation({
  execution_attestation,      // issued by a substrate/adaptor issuance boundary — see below
  resolution_receipt: compiled.compiled.resolution_receipt,
  role_envelope: compiled.compiled.role_envelope,
  execution_contract: compiled.compiled.execution_contract,
});
```

The result is exact, never a score:

- `EXECUTION_CONFORMANT`, or `NON_CONFORMANT` with the exact deviations
  (`MODEL_MISMATCH`, `EXECUTION_TARGET_MISMATCH`, `RESOLUTION_RECEIPT_MISMATCH`,
  `EXECUTION_CONTRACT_MISMATCH`, `ROLE_ENVELOPE_MISMATCH`, `FRESH_SESSION_NOT_EVIDENCED`,
  `TOOL_POLICY_NOT_EVIDENCED`, `TOOL_POLICY_VIOLATION`, `ENFORCEMENT_NOT_EVIDENCED`,
  `UNTRUSTED_EXECUTION_EVIDENCE`).
- A separate acceptance result: `ACCEPTANCE_VERIFIED`, `ACCEPTANCE_NOT_VERIFIED`, or
  `ACCEPTANCE_NOT_DECLARED`. A bound assertion is `ASSERTION_BOUND` until evidence shows the exact
  bound verifier ran and passed for that reference — a different verifier's success, a reported
  failure, and silence are all NOT VERIFIED.
- Only dimensions the contract requires are demanded: no tool policy means no tool evidence, no
  declared assertions means no verifier outcomes, no `required` enforcement means no enforcement
  evidence.

Evidence is issued, not asserted: only an attestation minted by an execution-attestation boundary in
the same process is accepted, so a caller-authored object with the right fields — a copy, a clone, a
JSON roundtrip — is refused as `UNTRUSTED_EXECUTION_EVIDENCE`. The Pi bridge issues that evidence for
the session it runs in; an integration that owns a subagents runtime issues it through its own
adapter. Charter stores no session, run, or workflow state to remember it.

**Observing a runtime is not owning it.** The adapter contract distinguishes the two positions
explicitly (F3). An adapter an ordinary package caller constructs with `createAdapterIntegration`
compiles with CANDIDATE evidence — unattested capability over exactly the axes it observed, an
availability claim instead of a model inventory, and `NON_CONFORMANT` +
`UNTRUSTED_EXECUTION_EVIDENCE` instead of issued execution evidence — and no axis it observes true can
reach `ENFORCED`. Only the host-authorized adapter context, held by the runtime integration the
package itself wires (the Pi bridge and the installed Pi extension) through an in-process capability
that is not exported from the package surface, has its observations promoted into trusted evidence. No
name — `pi-charter`, `pi-subagents`, `parent`, or a file called `pi-charter.ts` — grants that position,
and observed `true`, observed `false`, and omitted remain three distinct observations end to end.

**Execution conformance requires the exact artifact link and an observed execution.** Issuing evidence
about a run is not the same as proving which governance artifact that run was admitted for, and an
admission is not the same as a run. `compileViaPi` (and every adapter integration) admits the compiled
artifact set and returns an opaque, process-local execution handle; the runtime that owns execution
reports that it actually executed that set (`observeExecutionViaPi`, or the adapter contract's
`observeExecution`), and verification issues evidence from the admission AND that observation, bound
to the session the run was observed in. A receipt, envelope, and contract supplied at verification
time are therefore a claim about a run, not evidence that this process admitted them, and neither is a
handle nothing ever executed: an unbound artifact is refused, an unobserved admission is refused, a
run observed in another session is refused, and an artifact that was not the admitted one is
`NON_CONFORMANT` — no matter that the session and model match.

---

## ⚠️ Boundaries / Non-Goals

`pi-charter` v0.1 strictly bounds itself to governance compilation. It deliberately does **not** provide:

- Task scheduler, queue, or job runner
- Worker registry or process pool
- Worker lifecycle supervision, monitoring, or health checks
- Session recovery, leases, or distributed locks
- Workflow database or persistent execution state
- Dynamic runtime capability discovery
- Generic executor orchestration framework
- Direct execution of Pi agent processes

These responsibilities belong to the execution substrate.

---

## 🛠️ Development / Verification

Maintainers can verify the package using standard npm scripts:

```bash
# Typecheck TypeScript sources
npm run typecheck

# Run test suite
npm test

# Compile the package to dist/ and record its build identity
npm run build

# Run typecheck, the compiled test suite, and the package dry-run
npm run verify

# Verify package contents (dry-run)
npm pack --dry-run
```

`npm test` compiles the package and then runs the emitted JavaScript tests, so the official path never
depends on a runtime that happens to execute TypeScript. Supported Node: `engines.node` = `>=22.0.0`.
The identity a receipt commits to is the digest of the shipped `dist/` runtime artifact set that
`npm run build` emitted (test artifacts excluded, exactly as `package.json` excludes them), and it is
verified against the artifact set actually executing: a rebuild of unchanged artifacts gives the same
identity, any material runtime artifact change gives a different one, and a modified artifact whose
record is stale refuses compilation with `COMPILER_IDENTITY_MISMATCH` until an explicit rebuild.

Bundled integration smokes:

```bash
npm run smoke:consumer   # pack, install into a throwaway consumer, compile + adapt through the tarball
npm run smoke:pi         # Pi discovers the extension and calls charter_compile / charter_verify_execution
npm run smoke:compiler   # tamper a shipped artifact copy: identity mismatch, then rebuild
```

Current test suite baseline: **252 tests, 252 PASS**.

---

## 🏷️ Release

`pi-charter` v0.1 is sealed and closed. The core compiler pipeline, schema contracts, target adapters, companion skill, and regression suite represent the complete, frozen v0.1 release boundary.
