// The bank's co-signature rules for owner actions (spec 05 "rule-specific checks"). The owner's own authorisation is
// verified on-chain by the hook; these checks are the bank's half of T3.
import { decodeAbiParameters, decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { OwnerActionKind as K, OWNER_ALONE, OWNER_ACTION_KINDS, POLICY_ABI, STANDING_ORDER_TUPLE, ownerActionPayloadHash, policyHash, type OwnerAction, type Policy, type StandingOrder } from '@praetor/protocol';

export class CosignRefused extends Error {
  status = 422;
}

export type CosignReaders = {
  /** MandateChecked emitted by the transaction `fiscoTx` on MandateRegistry, if any. */
  mandateChecked(fiscoTx: Hex): Promise<{ account: Address; policyHash: Hex; ok: boolean } | null>;
  kyaAgentKey(account: Address): Promise<Address>;
  perTxCap(account: Address): Promise<bigint>;
  modules: { passkeyValidator: Address; agentKeyValidator: Address; standingOrders: Address; mandateHook: Address };
};

const moduleAbi = parseAbi(['function installModule(uint256 moduleTypeId, address module, bytes initData)', 'function uninstallModule(uint256 moduleTypeId, address module, bytes deInitData)']);
const lower = (a: string) => a.toLowerCase();

export async function checkCosign(a: OwnerAction, payload: Hex, r: CosignReaders): Promise<void> {
  const name = OWNER_ACTION_KINDS[a.action];
  if (!name) throw new CosignRefused('unknown owner action');
  if (OWNER_ALONE.has(name)) throw new CosignRefused(`${name} is an owner alone action: the bank does not co-sign it`);
  if (ownerActionPayloadHash(a.account, a.action, payload) !== a.payloadHash) throw new CosignRefused('payload does not match payloadHash');
  switch (a.action) {
    case K.SET_POLICY: {
      const [p] = decodeAbiParameters(POLICY_ABI, payload) as unknown as [Policy];
      const checked = await r.mandateChecked(a.fiscoRef);
      if (!checked || !checked.ok || lower(checked.account) !== lower(a.account) || checked.policyHash !== policyHash(p)) {
        throw new CosignRefused('no successful bank check on FISCO for this policy (fiscoRef)');
      }
      return;
    }
    case K.SET_AGENT_KEY: {
      const [key] = decodeAbiParameters([{ type: 'address' }, { type: 'uint48' }], payload);
      if (lower(key) !== lower(await r.kyaAgentKey(a.account))) throw new CosignRefused('agent key differs from the KYA (only the TEE key the bank verified)');
      return;
    }
    case K.ADD_STANDING_ORDER: {
      const [o] = decodeAbiParameters([STANDING_ORDER_TUPLE], payload) as unknown as [StandingOrder];
      if (lower(o.account) !== lower(a.account)) throw new CosignRefused('standing order for another account');
      if (o.amount > (await r.perTxCap(a.account))) throw new CosignRefused('standing order above the bank per-transaction cap');
      return;
    }
    case K.MODULE_CHANGE: {
      const d = decodeFunctionData({ abi: moduleAbi, data: payload });
      const [, module] = d.args as readonly [bigint, Address, Hex];
      if (d.functionName === 'uninstallModule' && lower(module) === lower(r.modules.mandateHook)) {
        throw new CosignRefused('the bank never co-signs removing the hook (the account would leave the mandate)');
      }
      if (!Object.values(r.modules).some((m) => lower(m) === lower(module))) throw new CosignRefused('not one of our modules');
      return;
    }
    case K.LINK_WECHAT:
    case K.SET_OWNER_KEY:
      return;
  }
}
