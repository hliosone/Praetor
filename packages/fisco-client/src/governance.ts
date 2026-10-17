// FISCO chain governance in auth mode (spec 04, Q22, V2): genesis committee = the bank's admin account alone, so its
// proposals pass on creation; bootstrap adds regulator and operator as governors, sets rates 51/51 (each later
// proposal needs a second vote) and switches deploys to a whitelist. Idempotent: every step checks state first.
import { parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fiscoClients, sendFisco } from './client.js';

export const COMMITTEE: Address = '0x0000000000000000000000000000000000010001';
export const CONTRACT_AUTH: Address = '0x0000000000000000000000000000000000001005';

export const committeeAbi = parseAbi([
  'function createUpdateGovernorProposal(address account, uint32 weight, uint256 blockNumberInterval) returns (uint256)',
  'function createSetRateProposal(uint8 participatesRate, uint8 winRate, uint256 blockNumberInterval) returns (uint256)',
  'function createSetDeployAuthTypeProposal(uint8 deployAuthType, uint256 blockNumberInterval) returns (uint256)',
  'function createModifyDeployAuthProposal(address account, bool openFlag, uint256 blockNumberInterval) returns (uint256)',
  'function voteProposal(uint256 proposalId, bool agree)',
  'function isGovernor(address account) view returns (bool)',
  'function proposalCount() view returns (uint256)',
]);
export const authAbi = parseAbi(['function deployType() view returns (uint256)', 'function hasDeployAuth(address account) view returns (bool)']);

const INTERVAL = 100_000n;

export type GovernanceKeys = { admin: Hex; regulator: Hex; operator: Hex };

export async function bootstrapGovernance(rpcUrl: string, keys: GovernanceKeys, deployers: Address[]): Promise<string[]> {
  const done: string[] = [];
  const admin = fiscoClients(rpcUrl, keys.admin);
  const reg = fiscoClients(rpcUrl, keys.regulator);
  const pub = admin.pub as PublicClient;
  const adminW = admin.wallet as WalletClient;
  const regW = reg.wallet as WalletClient;
  const regAddr = privateKeyToAccount(keys.regulator).address;
  const opAddr = privateKeyToAccount(keys.operator).address;
  const isGov = (a: Address) => pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'isGovernor', args: [a] });
  const regIsGov = await isGov(regAddr);
  if (!regIsGov) {
    await sendFisco(pub, adminW, { address: COMMITTEE, abi: committeeAbi, functionName: 'createUpdateGovernorProposal', args: [regAddr, 1, INTERVAL] });
    done.push('governor regulator');
  }
  if (!(await isGov(opAddr))) {
    await proposeAndVote(pub, adminW, regW, regIsGov, 'createUpdateGovernorProposal', [opAddr, 1, INTERVAL]);
    done.push('governor operator');
  }
  if (!regIsGov) {
    // Rates after the governors: from here on a proposal needs two of the three votes.
    await proposeAndVote(pub, adminW, regW, false, 'createSetRateProposal', [51, 51, INTERVAL]);
    done.push('rates 51/51');
  }
  if ((await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'deployType' })) !== 1n) {
    await proposeAndVote(pub, adminW, regW, true, 'createSetDeployAuthTypeProposal', [1, INTERVAL]);
    done.push('deploy whitelist on');
  }
  for (const d of deployers) {
    if (!(await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'hasDeployAuth', args: [d] }))) {
      await proposeAndVote(pub, adminW, regW, true, 'createModifyDeployAuthProposal', [d, true, INTERVAL]);
      done.push(`deployer ${d}`);
    }
  }
  return done;
}

/** The admin proposes; once rates are 51/51 the regulator's vote is the second one. */
async function proposeAndVote(pub: PublicClient, admin: WalletClient, regulator: WalletClient, needsVote: boolean, fn: string, args: readonly unknown[]) {
  await sendFisco(pub, admin, { address: COMMITTEE, abi: committeeAbi, functionName: fn, args });
  if (!needsVote) return;
  const id = await pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'proposalCount' });
  await sendFisco(pub, regulator, { address: COMMITTEE, abi: committeeAbi, functionName: 'voteProposal', args: [id, true] });
}
