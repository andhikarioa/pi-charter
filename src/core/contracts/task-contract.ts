/**
 * TaskContract schema — v0.1 Phase 1.
 * Structured fields are authoritative (spec §12). No field here is inferred from prose.
 */

/** Canonical roles (spec §6). Exactly five for v0.1. */
export const ROLES = ['planner', 'implement', 'review', 'correct', 'adjudicate'] as const;
export type Role = (typeof ROLES)[number];

/** Task classes (spec §8). A routing input; never an authority grant. */
export const TASK_CLASSES = ['T0', 'T1', 'T2', 'T3', 'T4'] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

export const RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type Risk = (typeof RISKS)[number];

/** Verification vocabulary (spec §19). Resolved here, executed by the target. */
export const VERIFICATION_LEVELS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export type ExecutionTargetName = 'parent' | 'subagents';

export interface Permissions {
  code_write: boolean;
  research: boolean;
  external_write: boolean;
  release: boolean;
}

export interface Authority {
  /** Explicit authority references. Each MUST bind uniquely (spec §13). */
  sources: string[];
}

export interface Scope {
  blockers?: string[];
  files?: string[];
  symbols?: string[];
  directories?: string[];
  /** Named contract sections. */
  sections?: string[];
  /** Explicit admission of unrestricted scope (spec §14). Absent ⇒ wildcard scope fails closed. */
  allow_unrestricted?: boolean;
}

export interface AcceptanceReview {
  required: boolean;
  independence: 'none' | 'independent';
  executor?: 'same_session' | 'fresh_session';
}

export interface Acceptance {
  commands?: string[];
  assertions?: string[];
  review?: AcceptanceReview;
}

export interface Limits {
  correction_rounds?: number;
  semantic_escalations?: number;
}

export interface TaskDescriptor {
  id: string;
  class: TaskClass;
  risk: Risk;
  /** T4 MUST be evidence-backed (spec §8). */
  evidence?: string[];
}

/**
 * Structured requested actions — closed vocabulary (spec §22).
 * Closed so that permission contradictions are decidable without a semantic classifier.
 */
export const STRUCTURED_ACTIONS = ['tag', 'push', 'publish', 'deploy'] as const;
export type StructuredAction = (typeof STRUCTURED_ACTIONS)[number];

/** Which permission each structured action requires (spec §21). */
export const ACTION_REQUIRES_PERMISSION: Record<StructuredAction, keyof Permissions> = {
  tag: 'release',
  push: 'external_write',
  publish: 'release',
  deploy: 'release',
};

export interface TaskContract {
  version: 'charter/v0.1';
  task: TaskDescriptor;
  role: Role;
  execution_target: ExecutionTargetName;
  root: string;
  authority: Authority;
  scope: Scope;
  permissions: Permissions;
  acceptance: Acceptance;
  verification: { level: VerificationLevel };
  limits?: Limits;
  actions?: StructuredAction[];
  non_goals?: string[];
}

/**
 * Role repository-mutation posture (spec §7).
 * Used in Phase 1 only to detect role/permission conflicts. Narrowing is Phase 2.
 */
export const ROLE_REPOSITORY_WRITES: Record<Role, boolean> = {
  planner: false, // §7.1 — planner produces contracts, not repository mutations
  implement: true, // §7.2 — repository mutation: task-controlled
  review: false, // §7.3 — repository mutation: read-only
  correct: true, // §7.4 — task-controlled write
  adjudicate: false, // §7.5 — repository mutation: read-only
};

