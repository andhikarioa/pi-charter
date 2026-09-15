/**
 * Jurisdiction resolution (spec §15, §16, §7).
 *
 * Jurisdiction is a first-class object: scope, authority, search space, mutation posture, and
 * terminal state are distinct dimensions and stay distinct.
 *
 * Role defaults may narrow jurisdiction. They never grant it, and TaskContract restrictions always
 * win over any wider default.
 */

import { ROLE_REPOSITORY_WRITES, type Permissions, type Role } from '../contracts/task-contract.ts';

/** Authority levels v0.1 can resolve to. `bounded` never means unrestricted. */
export type AuthorityLevel = 'none' | 'bounded';

export interface MutationJurisdiction {
  /** `write` requires the narrowed repository write permission. */
  repository: 'none' | 'write';
  /** `write` requires `permissions.external_write`. */
  external: 'none' | 'write';
  /** `authorized` requires `permissions.release`. Release is always explicit (spec §21). */
  release: 'none' | 'authorized';
}

export interface Jurisdiction {
  scope: 'bounded';
  product_semantics: AuthorityLevel;
  architecture: AuthorityLevel;
  implementation: AuthorityLevel;
  search_space: 'bounded';
  archaeology: boolean;
  research: boolean;
  mutation: MutationJurisdiction;
}

/**
 * Frozen v0.1 role defaults (spec §7). Each entry is the widest jurisdiction the role may ever
 * hold; resolution takes the narrower of (role default, TaskContract restriction).
 *
 * No v0.1 TaskContract field grants product semantics or architecture authority, so both resolve to
 * `none` for every role — including adjudicate (spec §7.5): premium reasoning never becomes
 * architecture ownership.
 */
export const ROLE_JURISDICTION_DEFAULTS: Record<
  Role,
  {
    product_semantics: AuthorityLevel;
    architecture: AuthorityLevel;
    implementation: AuthorityLevel;
    repository_mutation: 'none' | 'task-controlled';
  }
> = {
  // §7.1 — produces contracts, not mutations; decomposition authority stays bounded.
  planner: { product_semantics: 'none', architecture: 'none', implementation: 'none', repository_mutation: 'none' },
  // §7.2 — bounded implementation; repository mutation is TaskContract-controlled.
  implement: {
    product_semantics: 'none',
    architecture: 'none',
    implementation: 'bounded',
    repository_mutation: 'task-controlled',
  },
  // §7.3 — read-only; finding authority stays bounded to the reviewed scope.
  review: { product_semantics: 'none', architecture: 'none', implementation: 'none', repository_mutation: 'none' },
  // §7.4 — bounded implementation restricted to accepted findings.
  correct: {
    product_semantics: 'none',
    architecture: 'none',
    implementation: 'bounded',
    repository_mutation: 'task-controlled',
  },
  // §7.5 — read-only; semantic authority stays bounded to the named contradiction.
  adjudicate: { product_semantics: 'none', architecture: 'none', implementation: 'none', repository_mutation: 'none' },
};

/**
 * Resolve jurisdiction from the role and the already-narrowed permissions.
 * Deterministic: same role and permissions always produce the same jurisdiction, and a wider
 * permission can never produce a narrower default than the role allows — the result tracks only
 * these two inputs, so nothing outside the contract can widen it.
 */
export function resolveJurisdiction(role: Role, permissions: Permissions): Jurisdiction {
  const defaults = ROLE_JURISDICTION_DEFAULTS[role];
  const canWrite = permissions.code_write && ROLE_REPOSITORY_WRITES[role];
  return {
    scope: 'bounded',
    // Charter never invents product semantics or architecture ownership (spec §2, §7.5).
    product_semantics: defaults.product_semantics,
    architecture: defaults.architecture,
    // Implementation authority requires BOTH the role default and the narrowed write permission.
    implementation: defaults.implementation === 'bounded' && canWrite ? 'bounded' : 'none',
    search_space: 'bounded',
    archaeology: false, // v0.1 admits no archaeology grant; the default stays off (spec §34)
    research: permissions.research,
    mutation: {
      repository: canWrite ? 'write' : 'none',
      external: permissions.external_write ? 'write' : 'none',
      release: permissions.release ? 'authorized' : 'none',
    },
  };
}
