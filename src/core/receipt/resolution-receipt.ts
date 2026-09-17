/**
 * Minimal deterministic compile receipt.
 *
 * A receipt is a projection of already-established canonical truth. It never validates a
 * TaskContract, resolves authority/model truth, or re-binds a target. Those decisions happen once
 * in the compile pipeline; the receipt only records enough identity/evidence to reconstruct what
 * was compiled and how enforcement truth was classified.
 */

import type { EnvironmentEvidence } from '../attestation/attestation.ts';
import type { ExecutionTargetName, Role } from '../contracts/task-contract.ts';
import {
  type EnforcementTruthTable,
  type TargetBinding,
} from '../enforcement/target-binding.ts';
import { evidenceIdentity, type EvidenceProvenance } from '../provenance/evidence.ts';

export const RECEIPT_CONTRACT_VERSION = 'charter/v0.1' as const;

export interface ResolutionReceipt {
  readonly contract_version: typeof RECEIPT_CONTRACT_VERSION;
  readonly compiler_identity: string;
  readonly execution_contract_identity: string;
  readonly task_id: string;
  readonly role: Role;
  readonly target: ExecutionTargetName;
  /** The resolved model identity that the canonical ExecutionContract selected. */
  readonly model: string;
  /** The exact authority provenance already established during resolution. */
  readonly authority_provenance: EvidenceProvenance[];
  /** Model availability evidence already carried by the canonical ExecutionContract. */
  readonly model_availability_evidence: EnvironmentEvidence;
  /** Capability evidence already carried by the canonical TargetBinding. */
  readonly capability_evidence: EnvironmentEvidence;
  /** Phase-3 enforcement truth, copied without reinterpretation. */
  readonly enforcement_truth: EnforcementTruthTable;
  readonly receipt_identity: string;
}

export interface ResolutionReceiptInput {
  compiler_identity: string;
  target_binding: TargetBinding;
}

/** Project canonical compile truth into a compact immutable receipt.
 *
 * This is an internal projection, not another admission boundary: it does not validate, resolve, or
 * bind anything again.
 */
export function createResolutionReceipt(input: ResolutionReceiptInput): ResolutionReceipt {
  const binding = input.target_binding;
  const contract = binding.execution_contract;
  const evidence = {
    contract_version: RECEIPT_CONTRACT_VERSION,
    compiler_identity: input.compiler_identity,
    execution_contract_identity: evidenceIdentity(contract),
    task_id: contract.task_id,
    role: contract.role,
    target: binding.target,
    model: contract.model.resolved,
    authority_provenance: structuredClone(contract.authority.provenance),
    model_availability_evidence: structuredClone(contract.model_availability),
    capability_evidence: structuredClone(binding.capability_evidence),
    enforcement_truth: structuredClone(binding.enforcement),
  };
  return deepFreeze({ ...evidence, receipt_identity: evidenceIdentity(evidence) });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
