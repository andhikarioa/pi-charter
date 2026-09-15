# PI-CHARTER v0.1 — CANONICAL MASTER BUILD SPEC

**Status:** FROZEN FOR v0.1 BUILD  
**Product type:** Pi-native governance package / extension  
**Primary language:** TypeScript  
**Core posture:** Deterministic, fail-closed, standalone governance compiler  
**Execution ownership:** External execution target (`parent` or `subagents`)  
**Communication ownership:** External; `pi-intercom` is optional  
**Runtime lifecycle ownership:** Explicitly out of scope

---

# 0. Authority and Purpose

This document is the canonical build authority for `pi-charter` v0.1.

It defines:

- the product thesis;
- the architectural boundary;
- the v0.1 contract model;
- the five canonical roles;
- deterministic routing and jurisdiction rules;
- execution-target truthfulness;
- fail-closed validation;
- model routing and fallback behavior;
- acceptance and verification semantics;
- bounded escalation rules;
- the v0.1 build phases;
- the release acceptance gate;
- explicit architectural non-goals.

This document does **not** define a future feature roadmap.

Future capabilities must earn admission from demonstrated usage or recurring operator pain.

## 0.1 Canonical precedence

For v0.1 implementation:

```text
1. this canonical v0.1 build spec
2. explicitly accepted v0.1 semantic corrections
3. current supported Pi execution-target capability contract
4. implementation mechanics
5. inference last
```

If implementation mechanics conflict with this specification, the specification wins.

If this specification requires a hard guarantee that the selected execution target cannot provide, the correct result is:

```text
UNSUPPORTED_BY_EXECUTION_TARGET
```

Do not implement a new runtime subsystem to manufacture the missing guarantee.

---

# 1. Product Thesis

`pi-charter` is a Pi-native software-agent governance compiler.

It converts an explicit, bounded `TaskContract` into a deterministic, truthful, bounded `ExecutionContract`.

Canonical transformation:

```text
TaskContract
    ↓
validate
    ↓
bind authority
    ↓
resolve role
    ↓
resolve model tier/profile
    ↓
resolve jurisdiction
    ↓
narrow authority / scope / permissions
    ↓
attach acceptance / verification / limits
    ↓
declare enforcement truth
    ↓
ExecutionContract
```

The resulting `ExecutionContract` can be executed by:

```text
target: parent
```

or:

```text
target: subagents
```

`pi-charter` is not an execution engine.

---

# 2. Architectural Constitution

The architectural constitution for v0.1 is:

> **Pi Charter may narrow, route, and compile authority; it may never invent product semantics, broaden authority, or own execution lifecycle.**

This rule is normative.

Any implementation or proposed feature that violates this constitution is out of scope.

## 2.1 Charter owns

`pi-charter` owns:

```text
TaskContract schema
TaskContract validation
authority binding
role semantics
role/task compatibility
task/risk → model-tier routing
model-profile selection
explicit fallback policy
jurisdiction resolution
scope narrowing
permission narrowing
acceptance schema
verification requirements
escalation limits
terminal-state policy
execution-target capability truth
prompt-envelope compilation
ExecutionContract generation
resolution receipts
```

## 2.2 Charter does not own

`pi-charter` MUST NOT own:

```text
process supervision
session lifecycle
worker lifecycle
worker registry
scheduler
queue
persistent workflow state
workflow recovery
crash recovery
session resurrection
locks
writer leases
repository concurrency
worktree implementation
message broker
model provider implementation
deployment engine
release engine
roadmap engine
release architecture
product architecture
general task DAG runtime
```

If any of these become necessary to satisfy a requested contract:

```text
STOP
→ report unsupported substrate/execution-target requirement
```

Do not create a new subsystem inside Charter.

---

# 3. Product Boundary

Canonical boundary:

```text
      USER / PROJECT POLICY
               ↓
          TaskContract
               ↓
        ┌────────────┐
        │ pi-charter │
        │            │
        │ validate   │
        │ bind       │
        │ route      │
        │ narrow     │
        │ compile    │
        └─────┬──────┘
              ↓
       ExecutionContract
          ┌───┴────┐
          ↓        ↓
       parent   subagents
          │        │
          └───┬────┘
              ↓
      execution evidence
              ↓
       PASS / BLOCKED /
      NEEDS_DECISION
```

Optional cross-session communication:

```text
pi-intercom
```

is external to the Charter core.

---

# 4. Dependency Model

## 4.1 Core dependency rule

The `pi-charter` semantic core MUST be usable without `pi-subagents` and without `pi-intercom`.

Core transformation:

```text
TaskContract
→ ExecutionContract
```

must remain standalone and deterministic.

## 4.2 Execution targets

v0.1 supports exactly two execution targets:

```text
parent
subagents
```

No generic executor framework is required for v0.1.

## 4.3 `parent`

`parent` means the active Pi parent session executes the resolved contract directly.

This is a first-class execution mode, not a fallback.

Typical use:

```text
planner
→ implement
→ review
→ correct
→ adjudicate
```

may all occur through the same parent session when the contract permits it.

The contract MUST remain truthful about review independence.

Example:

```yaml
review:
  executor: same_session
  independence: none
```

A same-session review MUST NOT be represented as independent review.

## 4.4 `subagents`

`subagents` is an optional execution adapter.

It may map resolved Charter constraints into supported `pi-subagents` mechanisms.

The adapter MUST NOT move `pi-subagents` lifecycle or runtime semantics into Charter core.

## 4.5 `pi-intercom`

`pi-intercom` is optional.

It may deliver:

```text
need_decision
semantic_contradiction
authority_contradiction
progress_update
```

between sessions where useful.

Charter defines the escalation intent.

Intercom owns message delivery.

---

# 5. Canonical Vocabulary

v0.1 freezes the following first-class concepts:

```text
TaskContract
ExecutionContract
Role
TaskClass
Risk
ModelTier
ModelProfile
Jurisdiction
Authority
Permission
Acceptance
Verification
ExecutionTarget
EnforcementTruth
Escalation
TerminalState
ResolutionReceipt
```

Do not create additional first-class abstractions unless a v0.1 acceptance case proves they are required.

---

# 6. Canonical Roles

v0.1 supports exactly five canonical roles:

```text
planner
implement
review
correct
adjudicate
```

Role names are semantic governance roles, not model names.

---

# 7. Role Semantics

## 7.1 `planner`

Purpose:

> Decompose already-admitted, sufficiently frozen work into a small number of independently verifiable bounded work units.

Planner MAY:

```text
read admitted contract
identify dependency order
produce bounded TaskContracts / phase cards
assign one trusted truth per work unit
derive acceptance from admitted truth
derive verification need
```

Planner MUST NOT:

```text
invent product capability
create roadmap
change release thesis
reopen product architecture
broaden admitted scope
increase authority
authorize release
authorize live mutation
turn decomposition into a general DAG runtime
```

Planner output aggregate authority and scope MUST be equal to or narrower than planner input authority and scope.

Each planner-produced work unit MUST contain:

```text
one trusted truth
scope
non-goals
acceptance
verification
DONE
STOP
```

## 7.2 `implement`

Purpose:

> Implement a bounded task whose product semantics and architecture are already sufficiently frozen.

Default posture:

```text
repository mutation: task-controlled
product semantics: NONE
architecture authority: NONE
implementation authority: BOUNDED
research: OFF unless explicitly granted
```

Implement MUST NOT invent new product semantics.

## 7.3 `review`

Purpose:

> Evaluate the current implementation against named contracts, acceptance criteria, and authorized critical invariants.

Default posture:

```text
repository mutation: read-only
finding authority: bounded
architecture authority: NONE
scope expansion: NONE
```

Review MAY produce:

```text
PASS
MATERIAL_FINDINGS
BLOCKED
```

Review MUST NOT silently become implementation.

A clean review is a valid result.

## 7.4 `correct`

Purpose:

> Apply only frozen, accepted findings from a prior review/adjudication result.

Default posture:

```text
repository mutation: task-controlled write
input scope: accepted findings only
product semantics: NONE
architecture authority: NONE
```

Correct MUST NOT reopen the reviewer’s jurisdiction or invent additional findings.

## 7.5 `adjudicate`

Purpose:

> Resolve one bounded semantic, authority, or contract contradiction that materially blocks truthful execution.

Default posture:

```text
repository mutation: read-only
semantic authority: bounded to named contradiction
architecture authority: NONE unless explicitly authorized
research: OFF unless explicitly granted
```

Adjudicate produces a bounded decision such as:

```text
FROZEN_DECISION
HUMAN_DECISION_REQUIRED
UNRESOLVED
```

Adjudicate MUST NOT become a general architecture review.

---

# 8. Task Classes

v0.1 may use the stable T0–T4 task classification:

```text
T0 mechanical
T1 bounded implementation
T2 cross-layer behavioral
T3 high-consequence / semantic-sensitive
T4 demonstrated architecture conflict
```

Task class is a routing input.

Task class MUST NOT itself grant broader authority.

T4 MUST be evidence-backed.

“Difficult implementation” alone does not make a task T4.

---

# 9. Model Tiers

v0.1 uses three stable model tiers:

```text
workhorse
reviewer
reasoning
```

Concrete model names live in a `ModelProfile`.

Example:

```yaml
profiles:
  default:
    workhorse:
      preferred: gemini-3.8-flash
      fallback: []

    reviewer:
      preferred: gpt-5.6-sol
      fallback:
        - deepseek-v4.1-flash

    reasoning:
      preferred: gpt-5.6-sol
      fallback: []
```

The semantic core MUST NOT hard-code vendor-specific routing assumptions.

---

# 10. Model Availability and Explicit Fallback

Model availability truth belongs to the active Pi/execution environment.

Charter owns suitability and explicit fallback policy.

Canonical algorithm:

```text
preferred available
→ choose preferred

preferred unavailable
+ explicit fallback available
→ choose first admitted available fallback

preferred unavailable
+ no admitted fallback available
→ MODEL_UNAVAILABLE
```

Forbidden behavior:

```text
silent substitution
closest-model guessing
same-vendor guessing
strongest-available guessing
automatic model promotion
```

Fallback MUST be explicitly declared.

---

# 11. TaskContract

A `TaskContract` is explicit user/project authority.

Minimal canonical shape:

```yaml
version: charter/v0.1

task:
  id: example-task
  class: T3
  risk: critical

role: correct

execution_target: parent

root: /absolute/project/root

authority:
  sources:
    - canonical-master
    - reviewer-findings

scope:
  blockers:
    - blocker-a
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
    - go vet ./...
  assertions:
    - blocker-a-eliminated
    - no-release-changes
  review:
    required: true
    independence: none

verification:
  level: V3

limits:
  correction_rounds: 2
  semantic_escalations: 1

non_goals:
  - architecture redesign
  - unrelated refactor
```

Not every role requires every field.

Validation rules define the minimum required fields by role/task shape.

---

# 12. Structured Fields Are Authoritative

v0.1 MUST NOT depend on broad NLP interpretation to determine governance authority.

Hard policy checks operate on structured fields.

Example:

```yaml
permissions:
  release: false

actions:
  - tag
```

is a hard contradiction.

But prose such as:

```text
"fix the release blocker"
```

MUST NOT be interpreted as a request to perform a release.

Natural-language text MAY produce a non-authoritative warning.

It MUST NOT override structured policy.

---

# 13. Authority Binding

Every authority source required by a `TaskContract` MUST bind unambiguously.

Example:

```yaml
authority:
  sources:
    - canonical-master
    - reviewer-findings
```

If one cannot be bound to one explicit authority source:

```text
AUTHORITY_UNRESOLVED
```

Charter MUST NOT:

```text
search for something similar
select a likely historical file
guess by filename resemblance
choose the newest-looking document
```

Ambiguous authority is a STOP condition.

---

# 14. Scope Model

Scope may include:

```text
blockers
files
symbols
directories
named contract sections
```

v0.1 does not require a static security engine.

However, bounded roles performing writes MUST have bounded scope.

Example:

```yaml
role: correct

scope:
  files: []
```

with `code_write: true`:

```text
INVALID_TASK_CONTRACT
```

Example:

```yaml
role: correct

scope:
  files:
    - "**/*"
```

requires an explicit override:

```text
CONTRACT_REQUIRES_EXPLICIT_OVERRIDE
```

No automatic broadening.

---

# 15. Jurisdiction

Jurisdiction is a first-class object.

Canonical shape:

```yaml
jurisdiction:
  scope: bounded

  product_semantics: none
  architecture: none
  implementation: bounded

  search_space: bounded
  archaeology: false
  research: false

  mutation:
    repository: write
    external: none
    release: none

  terminal:
    success: acceptance_verified
    ambiguity: escalate
```

The following are distinct dimensions:

```text
scope
authority
search space
terminal state
```

A task can remain inside file scope while still wandering outside semantic jurisdiction.

Charter MUST preserve these distinctions.

---

# 16. Monotonic Narrowing Invariant

This is a hard v0.1 invariant.

For any resolved contract:

```text
ExecutionContract.scope
⊆ TaskContract.scope

ExecutionContract.authority
⊆ TaskContract.authority

ExecutionContract.permissions
⊆ TaskContract.permissions
```

Recipes, roles, profiles, adapters, and defaults MAY narrow authority.

They MUST NEVER broaden it.

Example:

```text
TaskContract:
code_write = false

Role default:
code_write = true
```

The role default MUST NOT grant write permission.

The resolver either:

```text
narrows to read-only
```

when the role remains semantically valid,

or fails with:

```text
CONTRACT_CONTRADICTION
```

if the role cannot truthfully operate under the narrower permission.

---

# 17. Role / Task / Permission Compatibility

The resolver MUST fail closed on contradictory contracts.

Example:

```yaml
role: review
task:
  class: T1
permissions:
  code_write: true
```

If `review` is defined read-only:

```text
INVALID_TASK_CONTRACT
role=review conflicts with code_write=true
```

No “best effort”.

Compatibility rules MUST be explicit and testable.

---

# 18. Acceptance Model

v0.1 accepts exactly three acceptance categories:

```text
commands
assertions
review
```

Example:

```yaml
acceptance:
  commands:
    - go test ./...
    - go vet ./...

  assertions:
    - blocker-a-eliminated
    - no-release-changes

  review:
    required: true
    independence: none
```

Invalid acceptance examples:

```text
make it production ready
ensure architecture is good
make it robust
improve quality
```

These are not verifiable enough for hard acceptance.

Result:

```text
ACCEPTANCE_INVALID
```

---

# 19. Verification Model

v0.1 may use the existing V0–V5 vocabulary:

```text
V0 inspection/reasoning
V1 focused tests
V2 local engineering gates
V3 bounded adversarial review
V4 staging/live integration proof
V5 release/production verification
```

Charter does not implement a test runner.

Charter resolves the required verification contract.

The execution target runs or supplies the evidence.

---

# 20. Terminal State

Every `ExecutionContract` MUST have an explicit terminal state.

Canonical success rule:

```text
required acceptance satisfied
+
required verification satisfied
→ PASS
→ STOP
```

A green result is allowed to remain green.

Charter MUST NOT append optional improvement work after terminal success.

---

# 21. Permission Model

v0.1 distinguishes at minimum:

```yaml
permissions:
  code_write: true|false
  research: true|false
  external_write: true|false
  release: true|false
```

Implementation permission does not imply external mutation.

External mutation does not imply release.

Release is always explicit.

Example:

```text
code_write = true
release = false
```

means the agent may edit code but may not tag, push a release, publish, deploy, or perform equivalent release authority unless separately admitted.

---

# 22. Forbidden Action Contradiction

If structured task actions contradict structured permissions, Charter MUST fail closed.

Example:

```yaml
permissions:
  release: false

actions:
  - tag
  - publish
```

Result:

```text
CONTRACT_CONTRADICTION
release=false conflicts with requested release action
```

v0.1 MUST NOT build a complex semantic action classifier.

Only explicit structured contradictions are hard-blocked.

---

# 23. Enforcement Truth

Charter MUST distinguish policy intent from substrate enforcement.

Canonical values:

```text
ENFORCED
INSTRUCTED
UNSUPPORTED
```

Example:

```yaml
enforcement:
  model_selection: ENFORCED
  allowed_tools: ENFORCED
  allowed_files: INSTRUCTED
  archaeology_off: INSTRUCTED
```

The exact result depends on the execution target capability snapshot.

Charter MUST NOT report `ENFORCED` when the target only receives prompt guidance.

---

# 24. Required Enforcement

A TaskContract MAY require hard enforcement for a named constraint.

Example:

```yaml
requirements:
  enforcement:
    allowed_tools: required
```

If selected target only supports:

```text
INSTRUCTED
```

result:

```text
UNSUPPORTED_BY_EXECUTION_TARGET
```

Charter MUST NOT implement its own tool sandbox to satisfy the request.

---

# 25. Execution-Target Capability Snapshot

Core resolution MAY receive a target capability snapshot.

Example:

```yaml
execution_target:
  name: parent

capabilities:
  model_selection: true
  fresh_session: false
  tool_ceiling: false
  file_scope_enforcement: false
  independent_review: false
```

or:

```yaml
execution_target:
  name: subagents

capabilities:
  model_selection: true
  fresh_session: true
  tool_ceiling: true
  file_scope_enforcement: false
  independent_review: true
```

The capability snapshot is an input to resolution.

It is not a persistent runtime registry owned by Charter.

---

# 26. Parent Execution Target

`parent` is a first-class v0.1 target.

The active parent session may execute one or more bounded role contracts sequentially.

Example:

```text
planner
→ implement
→ review
→ correct
→ review
```

Charter MUST NOT own the cycle state.

It MAY resolve the next bounded contract when asked.

It MUST NOT persist:

```text
current workflow step
active worker state
retry timers
resume tokens
crash recovery state
```

## 26.1 Review independence truth

Same-session review:

```yaml
review:
  executor: same_session
  independence: none
```

Fresh independent review:

```yaml
review:
  executor: fresh_session
  independence: independent
```

If contract requires independent review and parent target cannot provide it:

```text
UNSUPPORTED_BY_EXECUTION_TARGET
```

Do not fabricate independence.

---

# 27. Subagents Execution Target

The `subagents` adapter converts an `ExecutionContract` into supported execution parameters.

Possible mappings include:

```text
role / agent
model
thinking
fresh context
allowed tools
acceptance evidence
capability ceilings
```

The adapter MUST:

```text
use substrate-native mechanisms where available
report actual enforcement truth
avoid reimplementing substrate lifecycle
```

The adapter MUST NOT:

```text
track workers itself
own child recovery
own worktrees
own locks
own process state
```

---

# 28. Intercom Integration

Intercom is optional.

Charter may emit escalation intent:

```text
NEED_DECISION
SEMANTIC_CONTRADICTION
AUTHORITY_CONTRADICTION
PROGRESS_UPDATE
```

An optional Intercom adapter may deliver this between sessions.

Intercom availability MUST NOT be required for:

```text
TaskContract validation
ExecutionContract resolution
parent execution
normal subagents execution
```

---

# 29. Escalation Policy

v0.1 keeps escalation finite and explicit.

Default categories:

```text
mechanical/execution failure
semantic ambiguity
authority contradiction
architecture contradiction
model unavailable
execution-target capability gap
```

Default responses:

```text
mechanical/execution failure
→ same role
→ maximum one clean retry where policy allows

semantic ambiguity
→ adjudicate

authority contradiction
→ adjudicate

architecture contradiction
→ human decision

model unavailable
→ explicit fallback or STOP

execution-target capability gap
→ STOP
```

---

# 30. Escalation and Correction Limits

v0.1 MUST support bounded limits.

Example:

```yaml
limits:
  correction_rounds: 2
  semantic_escalations: 1
```

If exceeded:

```text
HUMAN_DECISION_REQUIRED
```

Execution targets own the actual iteration.

Charter only defines and validates the allowed limits.

Charter MUST NOT implement a workflow loop engine.

---

# 31. De-escalation

A reasoning/adjudication role does not gain ownership of subsequent implementation.

After a hard semantic decision is frozen:

```text
adjudicate
→ bounded frozen decision
→ implement/correct under normal workhorse policy
```

Premium reasoning does not imply broader scope or permanent ownership.

---

# 32. Prompt Envelope Compiler

v0.1 includes deterministic prompt-envelope composition.

It MUST NOT require an LLM to generate governance rules.

Canonical composition:

```text
Base governance
+
Role overlay
+
Jurisdiction
+
Task semantics
+
Acceptance / verification
+
Escalation
+
STOP
```

Recommended output order:

```text
ROLE
CURRENT TASK
AUTHORITY
JURISDICTION
SCOPE
NON-GOALS
PERMISSIONS
OPERATING RULES
ACCEPTANCE
VERIFICATION
ESCALATION
TERMINAL STATE
```

The prompt compiler transports task/domain semantics.

It MUST NOT invent them.

---

# 33. TODO-First Policy

Charter MAY support a governance instruction such as:

```yaml
operating_rules:
  todo_first: true
  max_todo_items: 8
```

When used, this is governance policy.

Whether it is hard-enforced or instruction-only depends on the execution target.

If the target cannot enforce it:

```text
INSTRUCTED
```

Do not misrepresent it as hard enforcement.

---

# 34. Archaeology and Search Policy

v0.1 MAY represent:

```yaml
search:
  archaeology: off
  mode: bounded
  allowed_roots: []
  budget:
    reads: 12
    searches: 8
```

This remains a contract/jurisdiction policy.

Charter MUST NOT implement a filesystem-wide search monitor or tool-call telemetry engine.

When target enforcement is unavailable:

```text
INSTRUCTED
```

---

# 35. ExecutionContract

Canonical resolved shape:

```yaml
version: charter/v0.1

task_id: example-task

execution_target: parent

role: correct

model:
  tier: reviewer
  preferred: gpt-5.6-sol
  resolved: gpt-5.6-sol
  fallback_used: false

jurisdiction:
  scope: bounded
  product_semantics: none
  architecture: none
  implementation: bounded
  search_space: bounded
  archaeology: false
  research: false
  mutation:
    repository: write
    external: none
    release: none

authority:
  bound_sources:
    - canonical-master
    - reviewer-findings

scope:
  blockers:
    - blocker-a
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
    - blocker-a-eliminated
  review:
    required: true
    independence: none

verification:
  level: V3

limits:
  correction_rounds: 2
  semantic_escalations: 1

enforcement:
  model_selection: ENFORCED
  allowed_files: INSTRUCTED
  release_forbidden: INSTRUCTED

terminal_state:
  success: acceptance_verified
  ambiguity: escalate
  limit_exceeded: human_decision_required
```

---

# 36. Resolution Receipt

Each resolution MAY emit a compact immutable receipt.

The receipt is evidence, not workflow state.

Suggested fields:

```text
contract version
TaskContract identity/hash
Charter config identity/hash
ModelProfile identity/hash
execution-target capability snapshot identity/hash
resolved role
resolved model
resolved jurisdiction
resolved permissions
enforcement truth
validation result
resolution result
```

The receipt MUST NOT become a runtime database.

---

# 37. Determinism Contract

Given equivalent:

```text
TaskContract
Charter configuration
ModelProfile
execution-target capability snapshot
```

the resolver MUST produce equivalent:

```text
ExecutionContract
```

No hidden LLM classification is permitted in the deterministic core.

No random selection.

No silent use of mutable historical run state.

No time-dependent routing except explicit current availability/capability inputs.

---

# 38. Error Taxonomy

v0.1 uses a deliberately small taxonomy.

Canonical errors:

```text
INVALID_TASK_CONTRACT
AUTHORITY_UNRESOLVED
SCOPE_CONTRADICTION
CONTRACT_REQUIRES_EXPLICIT_OVERRIDE
ACCEPTANCE_INVALID
MODEL_UNAVAILABLE
ROUTING_UNRESOLVED
CONTRACT_CONTRADICTION
HUMAN_DECISION_REQUIRED
UNSUPPORTED_BY_EXECUTION_TARGET
```

Do not create dozens of specialized error states unless a concrete v0.1 acceptance case requires one.

---

# 39. Mandatory Edge Cases

v0.1 is not complete unless all ten cases below have deterministic regression coverage.

## E1 — Model unavailable

Given:

```yaml
reviewer:
  preferred: sol-high
  fallback: []
```

and preferred unavailable:

```text
MODEL_UNAVAILABLE
```

No silent substitution.

## E2 — Role/task/permission conflict

Example:

```yaml
role: review
task_class: T1
permissions:
  code_write: true
```

Result:

```text
INVALID_TASK_CONTRACT
```

## E3 — Authority unresolved

Required authority cannot bind uniquely:

```text
AUTHORITY_UNRESOLVED
```

No “closest match”.

## E4 — Invalid or overbroad scope

Bounded write role with empty scope:

```text
INVALID_TASK_CONTRACT
```

Bounded correction with unrestricted scope:

```text
CONTRACT_REQUIRES_EXPLICIT_OVERRIDE
```

## E5 — Unverifiable acceptance

Example:

```text
make production ready
ensure architecture is good
```

Result:

```text
ACCEPTANCE_INVALID
```

## E6 — Semantic/correction loop

Limits exceeded:

```text
HUMAN_DECISION_REQUIRED
```

No unbounded review/oracle/correct loop.

## E7 — Forbidden structured action

Example:

```text
release=false
+
action=tag
```

Result:

```text
CONTRACT_CONTRADICTION
```

## E8 — Resolver broadening

Any resolver output that broadens:

```text
scope
authority
permissions
```

must fail tests.

Monotonic narrowing is mandatory.

## E9 — Deterministic resolution

Equivalent explicit inputs MUST yield equivalent ExecutionContracts.

## E10 — Enforcement truthfulness

If an execution target cannot hard-enforce a constraint:

```text
ENFORCED
```

MUST NOT be reported.

Use:

```text
INSTRUCTED
```

or:

```text
UNSUPPORTED
```

as appropriate.

---

# 40. Suggested Module Boundary

Implementation may vary, but the architecture should remain recognizably thin.

Suggested shape:

```text
src/
  core/
    contracts/
    validation/
    authority/
    routing/
    jurisdiction/
    resolver/
    acceptance/
    enforcement/
    prompt/
    receipt/

  adapters/
    parent/
    subagents/
    intercom/
```

Rules:

```text
core/
→ MUST NOT depend on subagents lifecycle APIs
→ MUST NOT depend on intercom
→ MUST remain deterministic

adapters/subagents/
→ may depend on supported subagents integration APIs

adapters/intercom/
→ optional only

adapters/parent/
→ compile/apply contract to active parent context
```

Do not split into multiple packages unless implementation proves a real need.

---

# 41. v0.1 Build Phases

v0.1 uses five behavioral phases.

Each phase establishes one new trusted truth.

---

## Phase 1 — Contract Schema and Fail-Closed Validation

### New trusted truth

> A valid TaskContract can be represented and accepted, while contradictory, ambiguous, or structurally invalid contracts fail closed before execution.

### Scope

Implement:

```text
TaskContract schema
canonical roles
permissions
authority references
scope schema
acceptance schema
limits schema
error taxonomy
role/task compatibility
scope validation
acceptance validation
structured forbidden-action validation
authority binding interface
```

### Required edge cases

```text
E2
E3
E4
E5
E7
```

### Non-goals

```text
no model invocation
no execution
no subagent spawn
no prompt compiler
no workflow state
```

### Verification

```text
schema tests
positive fixtures
negative fixtures
deterministic validation tests
```

### DONE

All Phase 1 validation fixtures pass.

### HARD STOP

Do not begin routing or adapter work inside Phase 1.

---

## Phase 2 — Deterministic Resolution and Monotonic Narrowing

### New trusted truth

> A valid TaskContract deterministically resolves role, model tier/profile, jurisdiction, scope, permissions, and terminal policy without broadening the original contract.

### Scope

Implement:

```text
ModelTier
ModelProfile
explicit fallback
role resolver
task/risk routing
jurisdiction resolver
permission narrowing
scope narrowing
terminal-state resolution
ExecutionContract
deterministic resolver
```

### Required edge cases

```text
E1
E8
E9
```

### Non-goals

```text
no runtime availability database
no model benchmark engine
no learning router
no execution adapter
```

### Verification

```text
resolver fixture tests
fallback tests
property tests for monotonic narrowing
determinism tests
```

### DONE

Equivalent inputs yield equivalent bounded ExecutionContracts.

### HARD STOP

Do not add runtime orchestration.

---

## Phase 3 — Execution-Target Capability Truth and Thin Adapters

### New trusted truth

> Charter can truthfully map an ExecutionContract to `parent` or `subagents` capability boundaries without claiming enforcement the target cannot provide.

### Scope

Implement:

```text
ExecutionTarget
capability snapshot
ENFORCED / INSTRUCTED / UNSUPPORTED
required-enforcement validation
parent adapter
subagents adapter
optional intercom integration seam
```

### Required edge case

```text
E10
```

### Acceptance

```text
parent target works without subagents installed
subagents target works when adapter is available
intercom is not required
unsupported hard-enforcement requirement fails closed
no runtime lifecycle code exists in Charter
```

### Non-goals

```text
no worker tracking
no scheduler
no recovery
no locks
no session resurrection
```

### HARD STOP

If an execution target lacks a primitive, report it. Do not implement the primitive in Charter.

---

## Phase 4 — Five Role Envelopes and Planner Boundary

### New trusted truth

> Planner, implement, review, correct, and adjudicate each compile into bounded role-appropriate execution envelopes without manual governance mega-prompts.

### Scope

Implement:

```text
role overlays
deterministic prompt composition
planner output contract
review independence truth
corrector accepted-findings boundary
adjudication bounded-decision boundary
TODO-first instruction option
archaeology/search instruction options
```

### Acceptance

```text
planner cannot broaden scope/authority
review defaults read-only
same-session review is not called independent
correct only receives frozen accepted findings
adjudicate does not gain implementation authority
prompt compiler transports but does not invent domain semantics
```

### Non-goals

```text
no general workflow DAG
no autonomous roadmap planning
no architecture planning engine
```

### HARD STOP

Five roles only for v0.1.

---

## Phase 5 — Bounded Escalation and Real-Workflow Acceptance

### New trusted truth

> The complete Charter pipeline operates safely on representative software-delivery workflows, respects bounded escalation, and fails closed on all v0.1 safety cases.

### Scope

Implement/verify:

```text
correction-round limits
semantic-escalation limits
one-clean-retry policy representation
human-decision terminal
real representative fixtures
full integration acceptance
resolution receipts
```

### Required representative fixtures

At minimum:

```text
routine bounded implementation
planner decomposition
critical correction
read-only review
semantic adjudication
model unavailable
authority ambiguity
release-forbidden contradiction
unsupported hard enforcement
resolver broadening attack
parent-only end-to-end cycle
subagents execution handoff
```

### DONE

All release acceptance criteria pass.

### HARD STOP

v0.1 is complete.

Do not add speculative post-v0.1 capabilities.

---

# 42. Release-Level Acceptance

`pi-charter` v0.1 is accepted only when all of the following are true:

```text
[ ] TaskContract schema is explicit and deterministic.

[ ] Invalid role/task/permission combinations fail closed.

[ ] Required authority binds unambiguously or fails closed.

[ ] Bounded write roles cannot silently receive empty/unrestricted scope.

[ ] Acceptance supports commands, assertions, and review requirements.

[ ] Fuzzy acceptance cannot masquerade as verifiable acceptance.

[ ] Model availability never triggers silent substitution.

[ ] Explicit fallback works deterministically.

[ ] Model suitability is separated from model availability.

[ ] ExecutionContract never broadens TaskContract scope.

[ ] ExecutionContract never broadens TaskContract authority.

[ ] ExecutionContract never broadens TaskContract permissions.

[ ] Correction rounds are bounded.

[ ] Semantic escalation rounds are bounded.

[ ] Limit exhaustion becomes HUMAN_DECISION_REQUIRED.

[ ] Structured forbidden actions fail closed.

[ ] Enforcement truth is ENFORCED / INSTRUCTED / UNSUPPORTED.

[ ] Required hard enforcement fails closed when target cannot supply it.

[ ] Parent mode works without pi-subagents installed.

[ ] Subagents integration remains a thin adapter.

[ ] Intercom remains optional.

[ ] Same-session review never claims independence.

[ ] Planner cannot broaden admitted work.

[ ] Corrector cannot reopen review scope.

[ ] Adjudicator cannot silently become implementer.

[ ] Prompt compilation is deterministic.

[ ] Same explicit inputs produce equivalent ExecutionContracts.

[ ] Resolution receipt is evidence only, not workflow state.

[ ] No scheduler exists inside Charter.

[ ] No worker lifecycle exists inside Charter.

[ ] No lock/lease mechanism exists inside Charter.

[ ] No crash/recovery runtime exists inside Charter.

[ ] All ten mandatory edge cases have regression coverage.

[ ] Representative parent-only and subagents workflows pass.
```

---

# 43. Explicit v0.1 Non-Goals

The following are explicitly excluded from v0.1:

```text
CLI product
general executor framework
generic DAG language
persistent run database
workflow scheduler
worker registry
process supervision
session recovery
writer locks
leases
worktree engine
queue
message broker
custom model provider
model benchmark suite
self-learning routing
automatic model promotion/demotion
automatic product risk classifier
automatic roadmap planner
release architecture compiler
automatic multi-release planner
automatic architecture redesign
general repository archaeology engine
tool-call wandering telemetry
production deployment
release publishing
```

Developer/debug commands MAY exist if implementation needs them, but they are not the product thesis and MUST NOT become an independent CLI architecture.

---

# 44. Anti-Overengineering Gate

Every proposed v0.1 addition must answer:

> **Can this capability be explained as necessary to transform TaskContract into a truthful, bounded ExecutionContract?**

If NO:

```text
REJECT
```

Additional gate:

> **Can the selected execution substrate already own this runtime mechanism?**

If YES:

```text
USE SUBSTRATE
DO NOT REIMPLEMENT
```

Red-flag filenames/concepts include:

```text
scheduler
lease
lock_manager
worker_state
process_registry
recovery_engine
resume_manager
queue
workflow_database
```

Their appearance requires architectural review before proceeding.

---

# 45. v1.0 Definition of Maturity

This is not a roadmap.

`pi-charter` reaches v1.0 when the v0.1 thesis is proven stable in real usage.

v1.0 maturity means:

```text
stable TaskContract semantics

stable ExecutionContract semantics

stable role semantics

stable model-profile semantics

stable parent execution-target contract

stable subagents adapter contract

truthful enforcement reporting

deterministic resolution

proven monotonic narrowing

proven bounded planner behavior

proven review/correction/adjudication boundaries

real use across multiple projects without project-specific hacks

no runtime/lifecycle subsystem has leaked into Charter
```

v1.0 MUST NOT require Charter to become:

```text
a scheduler
a runtime
a workflow engine
a worker supervisor
a lock/lease authority
```

If reaching v1.0 appears to require those systems, the architecture must be reconsidered rather than expanded automatically.

---

# 46. Canonical v0.1 Completion Statement

The intended v0.1 end state is:

```text
pi-charter
=
a small deterministic Pi-native governance compiler

input:
TaskContract

output:
ExecutionContract

execution:
parent or subagents

communication:
optional intercom

core guarantees:
fail closed
never silently substitute
never broaden authority
never fabricate enforcement
never fabricate review independence
bounded escalation
verifiable acceptance
deterministic resolution
explicit STOP

runtime ownership:
none
```

When this contract is satisfied:

```text
v0.1 PASS
→ STOP
```

Do not create a feature roadmap merely because v0.1 is complete.
