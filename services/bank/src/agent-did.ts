// The agent's WeID (spec 05, F1 step 10): created from the agent key's public key (admin pays the gas through
// weid-rest), then its AgentWallet and MCP services set by an updateWeId transaction the agent-signer TEE builds and
// signs itself (sign-weid); the bank only relays it to FISCO and reads the document back. Idempotent.
import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';

export type AgentDidDeps = {
  signer: {
    createDid(account: string): Promise<{ address: Address; publicKeyECDSA: string }>;
    addService(account: string, fields: { weIdContract: Address; nonce: number; updated: string; authentication: string[]; service: string[]; add: { type: string; endpoint: string }[] }): Promise<{ rawTx: Hex }>;
  };
  weid: { createWeIdWithPubKey(publicKeyECDSA: string): Promise<string>; contracts(): Promise<{ weId: string }> };
  fisco: {
    exists(agent: Address): Promise<boolean>;
    resolve(agent: Address): Promise<{ authentication: string[]; service: string[] }>;
    nonce(agent: Address): Promise<number>;
    sendRaw(rawTx: Hex): Promise<{ status: 'success' | 'reverted' }>;
  };
  mcpUrl: string;
  now?: () => number;
};

const hasServices = (service: string[], account: string, mcpUrl: string) =>
  service.some((s) => s.endsWith(`,AgentWallet,eip155:84532:${account}`)) && service.some((s) => s.endsWith(`,MCP,${mcpUrl}`));

export async function createAgentDid(d: AgentDidDeps, accountIn: string): Promise<{ agentWeId: string; agentDidHash: Hex }> {
  // agent-signer accepts only the checksummed account in the AgentWallet endpoint.
  const account = getAddress(accountIn);
  const { address, publicKeyECDSA } = await d.signer.createDid(account);
  const agentWeId = `did:weid:101:${address.toLowerCase()}`;
  const out = { agentWeId, agentDidHash: keccak256(toHex(agentWeId)) };
  if (await d.fisco.exists(address)) {
    const doc = await d.fisco.resolve(address);
    if (hasServices(doc.service, account, d.mcpUrl)) return out;
  } else {
    const created = await d.weid.createWeIdWithPubKey(publicKeyECDSA);
    if (created.toLowerCase() !== agentWeId) throw new Error('weid-rest created another WeID than the agent key');
  }
  const doc = await d.fisco.resolve(address);
  const { weId } = await d.weid.contracts();
  const { rawTx } = await d.signer.addService(account, {
    weIdContract: weId as Address, nonce: await d.fisco.nonce(address), updated: String(Math.floor((d.now?.() ?? Date.now() / 1000))),
    authentication: doc.authentication, service: doc.service,
    add: [{ type: 'AgentWallet', endpoint: `eip155:84532:${account}` }, { type: 'MCP', endpoint: d.mcpUrl }],
  });
  if ((await d.fisco.sendRaw(rawTx)).status !== 'success') throw new Error('updateWeId reverted');
  if (!hasServices((await d.fisco.resolve(address)).service, account, d.mcpUrl)) throw new Error('agent DID services not on chain after the update');
  return out;
}
