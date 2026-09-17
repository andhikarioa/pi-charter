# Changelog

## v0.2.0 — lean architecture release (2026-09-17)

Pi Charter stops at compilation/policy. This release is a **breaking SDK/API cleanup**: the
post-execution verification lifecycle and the escalation lifecycle are removed, the compile path is
compression-simplified, and duplicated public artifact machinery is reduced. Authority, scope, and
capability-truth guarantees are unchanged and remain enforced by the same fail-closed tests.

### Removed

- Charter-owned post-execution admission, execution handles, attestation/conformance verification, and execution registries.
- Retry/escalation lifecycle policy and its counters/terminal state.
- Canonical `Jurisdiction` state and duplicated rich governance projections.
- Public low-level compiler-phase composition APIs that were not needed by a real consumer.

### Simplified

- Authority is bound once per declared reference on the high-level compile path.
- Target capability is bound once and projected downstream.
- `ExecutionContract` is the single rich resolved governance artifact.
- Role instruction and resolution receipt are projections rather than parallel governance universes.
- Pi exposes one operator tool: `charter_compile`.
- Operator output uses `ALLOWED` / `REFUSED` and shows enforcement truth explicitly.
- Active architecture/maintenance documentation is reduced to a small current set.

### Preserved

- fail-closed authority and scope behavior;
- explicit mutation permission;
- model-resolution honesty;
- `ENFORCED / INSTRUCTED / UNSUPPORTED / NOT_APPLICABLE` semantics;
- caller-claim versus trusted-runtime-observation separation;
- truthful fresh-session and delegation semantics;
- zero runtime dependencies.
