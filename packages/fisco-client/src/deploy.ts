// Deploys the consortium contracts (spec 04): MemberRegistry (bootstrapped with members, the Base domain and the
// transports), BaseOutbox, the boards; registers the boards in the outbox and seals it.
import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import { deployFisco, fiscoClients, sendFisco } from './client.js';
import { fiscoAbis, fiscoBytecodes } from './abis.generated.js';

export type ConsortiumConfig = {
  deployerKey: Hex;
  members: { fiscoAccount: Address; baseSigner: Address }[];
  baseHook: Address;
  domainName: string;
  router: Address;
  relayer: Address;
  usdc: Address;
};

export type ConsortiumDeployment = {
  memberRegistry: Address; baseOutbox: Address; agentStatus: Address; assetRegistry: Address; sanctionsList: Address;
  jurisdictionRules: Address; attesterRegistry: Address; mandateRegistry: Address; auditLog: Address;
};

export async function deployConsortium(rpcUrl: string, c: ConsortiumConfig): Promise<ConsortiumDeployment> {
  const { pub: p, wallet } = fiscoClients(rpcUrl, c.deployerKey);
  const pub = p as PublicClient;
  const w = wallet as WalletClient;
  const dep = (name: keyof typeof fiscoAbis, args: readonly unknown[] = []) => deployFisco(pub, w, fiscoAbis[name] as never, fiscoBytecodes[name], args);
  const memberRegistry = await dep('MemberRegistry');
  await sendFisco(pub, w, {
    address: memberRegistry, abi: fiscoAbis.MemberRegistry as never, functionName: 'bootstrap',
    args: [c.members.map((m) => ({ fiscoAccount: m.fiscoAccount, baseSigner: m.baseSigner, sm2Binding: '0x' })), c.baseHook, c.domainName, c.router, c.relayer],
  });
  const baseOutbox = await dep('BaseOutbox', [memberRegistry]);
  const board = (name: keyof typeof fiscoAbis) => dep(name, [memberRegistry, baseOutbox]);
  const agentStatus = await board('AgentStatus');
  const assetRegistry = await board('AssetRegistry');
  const sanctionsList = await board('SanctionsList');
  const jurisdictionRules = await board('JurisdictionRules');
  const attesterRegistry = await board('AttesterRegistry');
  const mandateRegistry = await dep('MandateRegistry', [memberRegistry, baseOutbox, assetRegistry, c.usdc]);
  const auditLog = await board('AuditLog');
  for (const b of [agentStatus, assetRegistry, sanctionsList, jurisdictionRules, attesterRegistry, mandateRegistry, auditLog]) {
    await sendFisco(pub, w, { address: baseOutbox, abi: fiscoAbis.BaseOutbox as never, functionName: 'addBoard', args: [b] });
  }
  await sendFisco(pub, w, { address: baseOutbox, abi: fiscoAbis.BaseOutbox as never, functionName: 'seal' });
  return { memberRegistry, baseOutbox, agentStatus, assetRegistry, sanctionsList, jurisdictionRules, attesterRegistry, mandateRegistry, auditLog };
}
