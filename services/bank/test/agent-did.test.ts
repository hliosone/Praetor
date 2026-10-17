import { describe, it, expect } from 'vitest';
import { getAddress, keccak256, toHex, type Hex } from 'viem';
import { createAgentDid, type AgentDidDeps } from '../src/agent-did.js';

const ACCOUNT = getAddress('0x00000000000000000000000000000000000c0ffe');
const AGENT = '0x00000000000000000000000000000000000a6e47';
const WEID = `did:weid:101:${AGENT}`;
const AUTH = `${WEID}#keys-1234abcd,Ed25519VerificationKey2020,${WEID},zKEY`;

function deps(over: Partial<AgentDidDeps> = {}) {
  const calls: string[] = [];
  const d: AgentDidDeps = {
    signer: {
      createDid: async () => { calls.push('createDid'); return { address: AGENT, publicKeyECDSA: 'cHVi' }; },
      addService: async (_acc, fields) => { calls.push(`addService:${JSON.stringify(fields.add)}:${fields.nonce}`); return { rawTx: '0xraw' as Hex }; },
    },
    weid: { createWeIdWithPubKey: async () => { calls.push('createWeIdWithPubKey'); return WEID; }, contracts: async () => ({ weId: '0x76e95182042d96160342ab6370919c6523c1895e' }) },
    fisco: {
      resolve: async () => { calls.push('resolve'); return { authentication: [AUTH], service: calls.includes('send') ? [`${WEID}#1,AgentWallet,eip155:84532:${ACCOUNT}`, `${WEID}#2,MCP,https://praetor.localhost/mcp`] : [] }; },
      exists: async () => calls.includes('createWeIdWithPubKey'),
      nonce: async () => 7,
      sendRaw: async () => { calls.push('send'); return { status: 'success' as const }; },
    },
    mcpUrl: 'https://praetor.localhost/mcp',
    now: () => 1_800_000_000,
    ...over,
  };
  return { d, calls };
}

describe('agent DID (F1 step 10)', () => {
  it('creates the WeID from the agent key in the TEE, then has the TEE sign the AgentWallet and MCP services', async () => {
    const { d, calls } = deps();
    const r = await createAgentDid(d, ACCOUNT);
    expect(r).toEqual({ agentWeId: WEID, agentDidHash: keccak256(toHex(WEID)) });
    expect(calls).toEqual(['createDid', 'createWeIdWithPubKey', 'resolve', `addService:${JSON.stringify([{ type: 'AgentWallet', endpoint: `eip155:84532:${ACCOUNT}` }, { type: 'MCP', endpoint: 'https://praetor.localhost/mcp' }])}:7`, 'send', 'resolve']);
  });

  it('is idempotent: an existing WeID with both services is only read back', async () => {
    const { d, calls } = deps({ fisco: { ...deps().d.fisco, exists: async () => true, resolve: async () => ({ authentication: [AUTH], service: [`${WEID}#1,AgentWallet,eip155:84532:${ACCOUNT}`, `${WEID}#2,MCP,https://praetor.localhost/mcp`] }) } });
    await createAgentDid(d, ACCOUNT);
    expect(calls).toEqual(['createDid']);
  });

  it('fails when the read-back does not show the services', async () => {
    const { d } = deps({ fisco: { ...deps().d.fisco, sendRaw: async () => ({ status: 'success' as const }), resolve: async () => ({ authentication: [AUTH], service: [] }) } });
    await expect(createAgentDid(d, ACCOUNT)).rejects.toThrow(/services/);
  });
});
