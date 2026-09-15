/**
 * pi-charter v0.1 — Phase 1 + Phase 2 surface.
 * TaskContract schema, fail-closed validation, and deterministic resolution to an ExecutionContract.
 * Enforcement truth, capability snapshots, and adapters are Phase 3 and are not exported here.
 */
export * from './core/contracts/errors.ts';
export * from './core/contracts/task-contract.ts';
export * from './core/contracts/execution-contract.ts';
export * from './core/authority/binder.ts';
export * from './core/validation/validate.ts';
export * from './core/routing/model-routing.ts';
export * from './core/jurisdiction/jurisdiction.ts';
export * from './core/resolver/resolve.ts';
