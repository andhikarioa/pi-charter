/**
 * Thin `parent` adapter (spec §26, §41 Phase 3).
 *
 * The parent target is the active session executing bounded role contracts in sequence. This adapter
 * does nothing but evaluate Charter truth for that target and return a bounded binding: it starts no
 * session, tracks no workflow step, retries nothing, recovers nothing, and holds no state.
 *
 * It depends on the Phase 3 core only — never on the subagents adapter, never on pi-subagents. The
 * parent target must work with zero subagents dependency.
 */

import type { CharterError } from '../../core/contracts/errors.ts';
import type { TargetBinding } from '../../core/enforcement/target-binding.ts';

/** Target-bound parent handoff. A binding, not a session: nothing here can start or track work. */
export type ParentHandoff = TargetBinding & { target: 'parent' };

export type ParentBindingResult =
  | { ok: true; handoff: ParentHandoff }
  | { ok: false; errors: CharterError[] };

/**
 * Bind a contract to the `parent` target. Any contract selecting another target is refused: the
 * adapter never substitutes itself for the target the contract selected, and the capability
 * snapshot must already describe `parent` (the core enforces that identity).
 */
export function bindParentTarget(binding: TargetBinding): ParentBindingResult {
  if (binding.target !== 'parent') {
    return {
      ok: false,
      errors: [
        {
          code: 'CONTRACT_CONTRADICTION',
          path: 'execution_target',
          message: `the parent adapter cannot serve execution_target=${binding.target}; no target is substituted`,
        },
      ],
    };
  }
  return { ok: true, handoff: binding as ParentHandoff };
}
