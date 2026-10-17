import { decodeErrorResult, type Hex } from 'viem';
import { REASONS, type ReasonName } from '@praetor/protocol';
import { MandateHookAbi } from './abis.generated.js';

/** Decodes MandateRefused(reason, callHash) from revert data; null for anything else. */
export function decodeRefusal(data: Hex): { reason: number; reasonName: ReasonName; callHash: Hex } | null {
  try {
    const d = decodeErrorResult({ abi: MandateHookAbi, data });
    if (d.errorName !== 'MandateRefused') return null;
    const [reason, callHash] = d.args as readonly [number, Hex];
    return { reason, reasonName: REASONS[reason]!, callHash };
  } catch {
    return null;
  }
}
