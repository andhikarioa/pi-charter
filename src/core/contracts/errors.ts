/**
 * Canonical v0.1 error taxonomy (spec §38).
 * Closed set. Do not add codes without an accepted v0.1 acceptance case.
 */
export const ERROR_CODES = [
  'INVALID_TASK_CONTRACT',
  'AUTHORITY_UNRESOLVED',
  'SCOPE_CONTRADICTION',
  'CONTRACT_REQUIRES_EXPLICIT_OVERRIDE',
  'ACCEPTANCE_INVALID',
  'MODEL_UNAVAILABLE',
  'ROUTING_UNRESOLVED',
  'CONTRACT_CONTRADICTION',
  'HUMAN_DECISION_REQUIRED',
  'UNSUPPORTED_BY_EXECUTION_TARGET',
] as const;

export type CharterErrorCode = (typeof ERROR_CODES)[number];

export interface CharterError {
  code: CharterErrorCode;
  /** Stable, field-pointing message. No prose interpretation, no heuristics. */
  message: string;
  /** Dotted path of the offending field, e.g. `permissions.code_write`. */
  path?: string;
}
