# PI CHARTER v0.1.2 — TASKLET DOGFOOD CLOSEOUT

Status: truthful evidence closeout. This document does not release, seal, tag, or version-bump
anything. It records what the dogfood actually proved, what it did not prove, and what remains open.

## 1. Purpose

Record the completed Pi Charter v0.1.2 dogfood against the Tasklet dummy project: the progression
(parent implementation → delegation → independent review → owner adjudication → bounded correction →
focused rereview), the findings that were discovered along the way, how each finding was disposed of,
and the exact boundary of what Charter may now claim.

The closeout is written to preserve weaker truth, not to maximize it. Where the only available
evidence is the dogfood session record, this document says so; where repository artifacts at the
frozen SHAs corroborate a claim, it cites them.

### Evidence sources and truth tiers

| Tier | Meaning | Where it lives |
| --- | --- | --- |
| Repository artifact | An immutable fact at a frozen SHA: commits, file contents, tests, smoke scripts, commit dates. | Pi Charter and Tasklet git history |
| Dogfood session record | Execution facts observed while the dogfood ran: compile attempt counts, admission statuses, verification verdicts, reviewer/corrector session behavior, rereview outcomes. | The dogfood session record; canonized in part in `tasklet/AGENTS.md` |
| Corroboration | A repository artifact consistent with a session-record claim without proving it. | Both repositories |

This closeout adds no new claims beyond those two tiers. It does not reopen v0.1.1 release claims, it
does not convert substrate observations into Charter attestation, and it does not upgrade declared
acceptance into machine-attested acceptance.

## 2. Frozen authority and identities

| Identity | SHA | Date (+0700) | Role |
| --- | --- | --- | --- |
| Tasklet product authority | `/Users/andhikarioa/Workspace/tasklet/CHARTER-DOGFOOD-DUMMY-BUILD-PLAN.md` | — | Product and dogfood plan (I1–I10, C1–C8, waves, gates) |
| Tasklet operating rules | `tasklet/AGENTS.md` | committed at `ea0fc991c62be373c55ea35d658eb8d6fdc021fc` | Repo-level dogfood operating rules (Charter-first, TODO-first, coordination canon, weaker truth) |
| Pi Charter v0.1.1 release | `5c2ccd2149a1f7c08bafa8b71951f88a4e2d7769` | 2026-09-16 12:09:41 | Sealed before this dogfood; not reopened or invalidated |
| Pi Charter v0.1.2 candidate | `9730704da82a8756e3fb1fc916aba1bade1d1823` | 2026-09-16 15:23:59 | Bounded delegation UX patch, independently reviewed |
| Pi Charter current HEAD | `f73173afd4ac4520b309a703d40d090af48057a9` | 2026-09-16 17:12:45 | Pi correction-surface patch on top of the candidate |
| Tasklet Wave 1A | `3f72e1deff1de5364da0328e94d1251245f09163` | 2026-09-16 12:16:55 | Parent-executed domain/app slice |
| Tasklet Wave 1B storage | `728f1a3` (short) | 2026-09-16 15:39:06 | Delegated storage slice, `internal/store/**` only |
| Tasklet Wave 2 baseline | `ea0fc991c62be373c55ea35d658eb8d6fdc021fc` | 2026-09-16 16:09:48 | Frozen baseline for the Wave 2 rerun |
| Tasklet Wave 2 result | `f8ba47f8cd2b47ccf6a9b6fc25923a373781f3cf` | 2026-09-16 16:22:57 | CLI integration + integration tests + README |
| Tasklet final HEAD | `1651ca68d35c9382095ed74ecf07907d21096c0c` | 2026-09-16 17:15:39 | P1 bounded correction |

Both working trees were clean at closeout time. Pi Charter `package.json` still reads `"version":
"0.1.1"`; no version bump was performed as part of this closeout.

## 3. Dogfood scenario

One small real product (`tasklet`, a local Go CLI with JSON persistence) was built under the frozen
build plan, with Pi Charter compiling bounded authority for each slice and pi-subagents providing
fresh delegated sessions. The scenario was chosen so a wrong governance workflow could not hide
behind implementation complexity.

Sequence actually executed:

1. **v0.1.1 starting point.** v0.1.1 was already sealed. The dogfood began from it to evaluate the
   next operator/delegation UX layer.
2. **Tasklet Wave 1A — parent implementation.** Charter role `implement`, target `parent`; core,
   domain, app, and the plan document were produced under that admission. D1, D2, and D3 were
   discovered in this phase.
3. **Initial Wave 1B delegation failure.** An `implement` / `target=subagents` / fresh-child request
   against v0.1.1 was refused: the Pi integration observed only parent runtime truth, so a
   compilable delegation could not compile under the parent's observation. This exposed UX1 (the
   operator had to inspect Charter internals to learn whether delegation could proceed).
4. **v0.1.2 delegation UX patch (`9730704`).** Two questions separated: *can Charter compile bounded
   authority for this target* (yes, for parent and subagents) and *can Charter attest the target
   runtime* (only for the session it observes). Natural intent → one `charter_compile` → bounded
   authority → `HANDOFF_READY` → substrate executes.
5. **Independent review of `9730704`.** Exactly three material defects were found (F1, F2, F3), all
   corrected, with focused rereview PASS before Tasklet continued.
6. **Wave 1B product + governance proof.** Storage implemented by a delegated fresh child;
   coordination settled on the native supervisor channel (`child → contact_supervisor`,
   `parent → subagent_supervisor`); pi-intercom became optional.
7. **Wave 2 parent integration.** First rerun correctly stopped on baseline drift because a
   Wave-2-shaped commit already existed; that prior commit was preserved and explicitly not
   consulted, the repo was reset to the exact frozen baseline, and Wave 2 was rerun normally.
8. **Independent reviewer dispatch — C7.** A fresh read-only reviewer returned one material product
   finding: P1, duplicate persisted task IDs.
9. **P1 owner adjudication and bounded correction — C8.** The first corrector attempt performed zero
   mutation because `role=correct` was structurally unreachable from the Pi tool surface
   (C8SURFACE). The Pi correction-surface patch (`f73173a`) exposed accepted correction authority as
   plain JSON, the corrector reran, and the correction landed as `1651ca6`.
10. **Focused rereview of P1.** Load and Save both refuse duplicate IDs; unique IDs pass; no silent
    repair; scope clean; no regressions. P1 closed; Tasklet ready for closeout.

## 4. What was proven

Proven by Charter at the parent target (record + corroborating artifacts):

- Bounded parent admission: `ADMITTED_FOR_EXECUTION` with an execution handle (`charter_compile`
  parent path, `extensions/pi-charter.ts`; smoke P8/P9 assertions).
- Parent execution observation: Pi's own `tool_execution_start` event is the substrate observation;
  compiling and verifying do not count as execution, and verifying before any work ran is refused.
- Execution conformance verification: `EXECUTION_CONFORMANT` for work this session actually ran
  under the admission (smoke; Wave 2 session record).
- One-call normal operator compile: Wave 2 ran with 1 compile attempt, 0 authoring retries, 0 source
  archaeology reads; the canonical delegation flow in the smoke script asserts exactly one compile
  attempt for the dogfood-shaped intent.
- Clean scope: Wave 2's commit `f8ba47f` touches only `cmd/tasklet/main.go`, `tests/cli_test.go`,
  `README.md` — the authorized Wave 2 surface.

Proven by Charter at the delegation boundary:

- Delegation authority compilation: `Authority BOUND` with a bounded scope and the named authority
  document (`compile-delegation.ts`; smoke P11).
- Handoff generation: `HANDOFF_READY` carrying role, root, scope, the single dispatch freshness
  truth, acceptance commands, routing tier as `REQUIREMENT_ONLY`, and an empty capability
  observation.
- The four truths stay four truths: `Runtime proof UNAVAILABLE` and `Execution proof UNAVAILABLE`
  are rendered in the result itself; no execution handle is minted for a child this process cannot
  observe, and `charter_verify_execution` refuses a delegation result.
- Coordination did not broaden authority (C5): the coordination channel is transport only; the
  canonical channel is the native supervisor (`tasklet/AGENTS.md` §5).
- Review independence path (C7): a fresh, write-denied, non-nesting reviewer child executed and
  returned a material finding, while Charter truthfully stated it could not attest the child.
- Correction provenance (C8): independent finding → explicit owner acceptance →
  `correction_authority` on the Pi surface → `role=correct` → bounded mutation → execution
  verification → focused rereview. The product correction `1651ca6` changed exactly
  `internal/store/json.go` and `internal/store/json_test.go`.

Proven by the substrate, not by Charter (see §8):

- A fresh child was actually created for delegated work, and a fresh reviewer child actually ran.
  These are substrate observations; Charter holds no execution handle for the child and attests
  nothing about it.

## 5. Evidence timeline

| Time (+0700) | Event | Evidence |
| --- | --- | --- |
| 12:09:41 | Pi Charter v0.1.1 sealed | `5c2ccd2`; release commit only touches `package.json`, `package-lock.json`, one version string in a test |
| 12:16:55 | Tasklet Wave 1A commit (plan, `go.mod`, `internal/task/**`, `internal/app/**`) | `3f72e1d` scope matches the parent-owned slice; Wave 1A PASS in `tasklet/AGENTS.md` §11 |
| — | D1, D2, D3 discovered during Wave 1A | Session record; D2's wording problem is restated verbatim in `operator-surface.ts` header |
| — | Initial Wave 1B delegation refused by v0.1.1; UX1 exposed | `tasklet/AGENTS.md` §11 (“Wave 1B: previously BLOCKED by Pi Charter v0.1.1 delegation UX”); `compile-delegation.ts` header |
| 15:23:59 | v0.1.2 delegation UX candidate `9730704` | 18 files; adds `src/operator/**`, `src/delegation/**`, rewires the extension and skill docs |
| — | Independent review finds F1, F2, F3; all corrected; focused rereview PASS | Session record; fixes and tests exist at HEAD (see §6) |
| 15:39:06 | Tasklet Wave 1B storage commit; `internal/store/**` only | `728f1a3` |
| — | Wave 1B governance proof: Authority BOUND / Handoff READY / Runtime proof UNAVAILABLE / Execution proof UNAVAILABLE / fresh child observed by substrate / C5 PASS | Session record; weaker-truth semantics canonized in `tasklet/AGENTS.md` §7 |
| 16:09:48 | Tasklet operating rules committed; coordination canon fixed | `ea0fc99` (= Wave 2 frozen baseline); `AGENTS.md` §5 |
| — | Wave 2 first run stops on baseline drift; prior Wave-2-shaped commit preserved but not consulted; repo reset to frozen baseline; rerun normal | Session record |
| 16:22:57 | Wave 2 result committed: CLI integration, integration tests, README | `f8ba47f`; session record: 1 compile attempt, 0 retries, 0 archaeology, `ADMITTED_FOR_EXECUTION`, execution observed, `EXECUTION_CONFORMANT`, scope clean, product gates PASS |
| — | C7 fresh reviewer returns P1 (duplicate persisted task IDs) | Session record; product consequence visible in `1651ca6` |
| — | Owner accepts P1; first corrector attempt mutates nothing (`role=correct` unreachable from the Pi surface — C8SURFACE) | Session record; unreachability visible in the pre-patch surface shape |
| 17:12:45 | Pi correction-surface patch on the candidate | `f73173a`; adds `correction_authority` to `extensions/pi-charter.ts` and `src/operator/operator-request.ts` (+ tests); independent bounded rereview returned `READY_TO_COMMIT` before commit |
| 17:15:39 | Tasklet correction commit: duplicate-ID rejection in Load and Save | `1651ca6`; 23 insertions / 8 deletions in `json.go`, new `TestJSONRejectsDuplicateTaskIDs` plus cases in `json_test.go` |
| — | Focused P1 rereview: Load/Save duplicates REFUSED, unique IDs PASS, no silent repair, scope CLEAN, no regressions | Session record; corroborated by the committed test at `1651ca6` |
| Closeout | Final Tasklet gates re-verified at `1651ca6` | `go test -count=1 ./...` PASS, `go vet ./...` PASS, `gofmt -l .` empty, `git diff --check` PASS, clean tree |

The preserved prior Wave-2-shaped commit was explicitly not consulted, per the dogfood plan's
baseline rule; this closeout did not inspect it either.

## 6. Findings ledger

| ID | Area | Finding | Material? | Disposition | Evidence / closure |
| --- | --- | --- | --- | --- | --- |
| D1 | Operator surface / acceptance | The Pi-native surface has no way to declare verifier-bound assertions; acceptance stays declared-commands only, so `ACCEPTANCE_NOT_DECLARED` (machine-attested sense) is the ceiling from this surface | YES — capability limitation | DOCUMENTED_LIMITATION | `src/operator/operator-request.ts` (`OPERATOR_KEYS`, `acceptanceFor`: “no assertion binding is invented here”); `extensions/pi-charter.ts` schema has no assertion/verifier input. Not fixed by any dogfood change. |
| D2 | Operator surface / wording | `ACCEPTANCE_NOT_DECLARED` could be read as “nothing was declared” even when command gates were declared, because the status is about machine-attested acceptance and the output never said so | YES — operator truth/usability | CLOSED | v0.1.2 surface remediation: `src/operator/operator-surface.ts` (“The dogfood finding was not that Charter lied…”) separates `commands DECLARED (n)` from `verifier evidence UNAVAILABLE / ASSERTION_BOUND, NOT VERIFIED`, and `renderVerification` explains the status. The status code itself is retained and remains truthful. |
| D3 | Verification practice | `git diff --check` is vacuous for untracked fresh files; the check inspects tracked diff only | YES — verification method weakness | DOCUMENTED_LIMITATION | No repository change addresses it in either repo. Mitigation where relevant: stage the fresh files or use an intent-to-add/staged check so the working-tree content is actually covered. This closeout's own `git diff --check` claim is bounded by this note. |
| F1 | Delegation truth | `fresh_context=REQUIRED` could coexist with `fresh_session_required=false` in the same handoff | YES — correctness/truth contradiction | CLOSED | `src/delegation/compile-delegation.ts`: one dispatch freshness truth is computed once as the union of the operator requirement and the contract's out-of-session review requirement; “Emitting `fresh_context=REQUIRED` beside `fresh_session_required=false` … is the contradiction this computation exists to make impossible.” Test `F1 — the handoff carries ONE dispatch freshness truth`; smoke P11 asserts both fields agree. |
| F2 | Public tool schema compatibility | The v0.1.1 advanced invocation (`task_contract` + `authority` evidence object) broke when v0.1.2 renamed the evidence field | YES — released contract regression | CLOSED | `src/operator/operator-request.ts` accepts the legacy object as an alias of `authority_evidence`; `extensions/pi-charter.ts` `prepareArguments` translates it before strict schema validation and refuses both spellings together; tests `F2 — …`; smoke P12 asserts the sealed invocation still admits the parent artifact set. |
| F3 | Authority resolution boundary | Lexical root containment could resolve an authority document, through a symlink, outside the declared root | YES — authority/security boundary | CLOSED | `resolveLocalAuthority` checks containment on `realpathSync` identities (“the boundary is a FILESYSTEM boundary, not a lexical one”); test `F3 — authority containment is a filesystem truth` refuses an escaping file link and directory link, admits an in-root link. |
| UX1 | Operator UX / delegation | v0.1.1 refused to compile a compilable delegation because it could only observe parent runtime truth; the operator was pushed into Charter source/reference archaeology, binder construction, or fake observation | YES — blocked the delegation path | CLOSED | v0.1.2 separates “can compile authority” from “can attest runtime”; simple intent normalization in `src/operator/operator-request.ts`; `HANDOFF_READY` in `compile-delegation.ts`; smoke P11 measures the canonical flow at exactly one compile attempt with 0 source reads, 0 reference reads, 0 config greps; extension prompt guidelines forbid source archaeology for normal work. |
| COORD1 | Coordination workflow | The initial assumption that pi-intercom was mandatory for delegated coordination failed; the canonical channel is the native Pi supervisor | YES — workflow blocked without it | SUPERSEDED | Direction accepted and canonized in `tasklet/AGENTS.md` §5: `child → contact_supervisor`, `parent → subagent_supervisor`, pi-intercom optional; “Do not require pi-intercom merely to prove delegation.” Wave 1B record: C5 PASS on the native channel. |
| C8SURFACE | Pi correction surface | `role=correct` was structurally unreachable from the Pi-native tool surface: core supported `CorrectionAuthorityBinder`, but `charter_compile` had no JSON-serializable way to state accepted correction authority; the first corrector attempt correctly mutated nothing | YES — blocked C8 | CLOSED | `f73173a` adds `correction_authority: [{ target, finding, acceptance }]`, converted package-side into the live binder (`src/operator/operator-request.ts` `normalizeCorrectionAuthority`, `extensions/pi-charter.ts` schema). Fail-closed: unaccepted/missing/duplicate/unknown targets and non-correct roles are refused; tests `CN6 — …`. Independent bounded rereview returned `READY_TO_COMMIT` before the patch was committed. |
| P1 | Tasklet product correctness | Persisted state allowed duplicate task IDs, violating invariant I1; duplicate IDs create ambiguous list identity and `done 1` affects only the first match | YES — product correctness | CLOSED | Owner ACCEPTED; correction `1651ca6` adds `checkTasks` (validate + duplicate detection) and applies it in both `Load` and `Save`, with no silent repair or renumbering; `TestJSONRejectsDuplicateTaskIDs` plus new cases; focused rereview record: Load/Save duplicates REFUSED, unique IDs PASS, no silent repair, scope CLEAN, no regressions. |

Ledger totals: 10 findings; 7 CLOSED (D2, F1, F2, F3, UX1, C8SURFACE, P1); 2 DOCUMENTED_LIMITATION
(D1, D3); 1 SUPERSEDED (COORD1); 0 open material blockers.

## 7. Capability truth table

| Capability | Proven result |
| --- | --- |
| Parent implement admission | PROVEN |
| Parent execution observation | PROVEN |
| Parent execution conformance verification | PROVEN |
| One-call normal operator compile | PROVEN |
| Delegation authority compilation | PROVEN |
| Subagents handoff generation | PROVEN |
| Fresh reviewer substrate execution | PROVEN BY SUBSTRATE, NOT CHARTER ATTESTATION |
| Child execution attestation by Charter | NOT PROVIDED |
| Native supervisor coordination | PROVEN |
| Coordination broadens authority | REFUSED / DOES NOT |
| Independent reviewer C7 | PROVEN |
| Owner-adjudicated correction authority | PROVEN |
| Pi-native `role=correct` admission | PROVEN |
| Correction provenance C8 | PROVEN |
| Verifier-attested acceptance | NOT GENERALLY PROVEN |
| Runtime lifecycle ownership | OUT OF SCOPE |

## 8. What remains weaker truth

- **Child Charter execution attestation: UNAVAILABLE.** A delegation compile mints no execution
  handle and states `Runtime proof UNAVAILABLE` / `Execution proof UNAVAILABLE`. This is the
  design, not a gap to fill silently: a handle minted for a child would let the parent's own tool
  executions be verified as the child's run. `charter_verify_execution` refuses a delegation
  handoff by construction.
- **Fresh child execution is a substrate observation, not Charter attestation.** Wave 1B and C7
  each observed an actual fresh child; Charter recorded only that it observed no child runtime.
  The two statements must not be merged into “Charter verified the child.”
- **Verifier-attested acceptance: NOT GENERALLY PROVEN.** The Pi-native surface exposes no
  assertion-binder input (D1). Wave 2's verification therefore reported `ACCEPTANCE_NOT_DECLARED`
  truthfully even though the declared command gates were executed by the session: declared commands
  are declarations the substrate runs, not verifier evidence, and not a pass. This closeout does not
  upgrade that status.
- **Acceptance vocabulary stays three-valued.** `declared commands ≠ commands actually executed ≠
  machine-attested acceptance` (`tasklet/AGENTS.md` §8). Only the middle term was observed in the
  parent paths; the third remains generally unavailable.
- **The delegated model is a requirement, never proof.** The handoff's routing truth is
  `REQUIREMENT_ONLY`; the model seen in a parent session is this session's observed model.
- **D3 verification-method nuance.** A plain `git diff --check` on a tree whose work is untracked
  fresh files proves less than it appears to; staged/cached verification is needed where that
  materially matters. This is a documented limitation of the practice, not of Charter.
- **Reviewer/corrector session behaviors are session-record evidence.** The C7 and C8 runs are
  recorded as observed; their repo consequences (the correction and its tests) are at `1651ca6`,
  but the child sessions themselves are not Charter-attested facts.

## 9. Architecture conclusions

The Mandor-derived constraint held. Pi Charter succeeded by remaining a policy/compiler/controller.
It did not become, and the dogfood provides no reason to make it become:

```text
runtime
scheduler
worker manager
lease system
recovery service
cross-runtime attestation platform
```

The unique value the dogfood demonstrated is the governance loop itself:

```text
authority narrowing
role routing
scope compilation
fail-closed admission
weaker-truth preservation
delegation handoff
review independence
correction provenance
```

Supporting observations:

- The Pi surface stayed two tools deep (`charter_compile`, `charter_verify_execution`) plus one
  substrate event subscription; the v0.1.2 growth was normalization and presentation, not authority.
- The delegation path deliberately stops at the handoff: dispatch, coordination, retries, and child
  lifecycle remain the dispatcher's work, outside Charter.
- The smoke script's P10 check inspects the extension source for lifecycle machinery
  (`child_process`, timers, filesystem writes, `process.exit`, randomness) and asserts none is
  present — the integration owns no lifecycle and persists nothing.
- Unsupported inputs fail closed rather than being repaired: unknown fields, ambiguous authority
  references, fresh-on-parent contradictions, `correction_authority` on non-correcting roles, both
  authority evidence spellings at once, and duplicate correction targets are each refused.

Do not expand lifecycle ownership on the strength of this dogfood.

## 10. Product conclusions

Tasklet is complete against its frozen plan:

- All planned waves complete: Wave 1A (`3f72e1d`), Wave 1B (`728f1a3`), Wave 2 (`f8ba47f`).
- Independent review exercised by a fresh read-only reviewer child.
- One real material product defect was discovered by that review: P1, duplicate persisted task IDs
  (invariant I1).
- The defect was owner-adjudicated (ACCEPTED), corrected under a bounded `role=correct` contract
  with exactly the two-file scope `internal/store/json.go`, `internal/store/json_test.go`, and
  closed by a focused rereview.
- Final Tasklet HEAD is `1651ca68d35c9382095ed74ecf07907d21096c0c`.
- Final gates re-verified during closeout at that HEAD: `go test -count=1 ./...` PASS,
  `go vet ./...` PASS, `gofmt -l .` empty, `git diff --check` PASS (bounded by D3); working tree
  clean.

This is the substantive result: the dogfood did not merely produce green tests. Governance surfaced
a real correctness bug in the product, and then controlled its correction end to end — reported
finding, explicit owner acceptance, bounded correction authority, bounded mutation, verification,
and rereview — without widening any authority.

## 11. Release implications

- v0.1.2 is **not** released. No tag, version bump, push, or packaging action was taken.
- `dogfood PASS != release tag`. The dogfood demonstrates the intended governance loop and the
  delegation/correction UX at `f73173a`; it does not itself satisfy or replace release procedures.
- The evidence supports moving to **v0.1.2 release-candidate closeout / release preparation**.
- Release-specific work remains separate and follows the existing project release process:
  version/package metadata (Pi Charter still reports `"version": "0.1.1"`), release notes,
  packaging/dist checks, and any release checklist the project already defines. This closeout
  invents no new release requirements.
- D1 (no Pi-native assertion-binder surface) and D3 (untracked-file diff-check nuance) are
  documented limitations, not release blockers under the existing process; verifier-attested
  acceptance must not be claimed in release notes.

## 12. Final dogfood verdict

```text
TASKLET DOGFOOD: PASS / CLOSED

Pi Charter v0.1.2 demonstrated its intended bounded-governance loop across:
implement → delegate → review → adjudicate → correct → rereview

within the documented trust boundary. It compiled authority, routed roles, bounded scopes,
failed closed on contradictions, preserved weaker truth for the unobservable child runtime,
handed off bounded delegation, worked with an independent reviewer, and carried a real
product defect from independent finding through owner acceptance to a verified bounded
correction.

The dogfood does not prove universal runtime attestation or verifier-backed acceptance,
and it does not expand Charter into execution-lifecycle ownership.

READY FOR v0.1.2 RELEASE PREPARATION.
```
