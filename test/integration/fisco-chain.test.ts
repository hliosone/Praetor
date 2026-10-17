// M4 link: the 4-node FISCO BCOS 3.17.1 chain in Docker (spec 04): web3 RPC, chain id, PBFT peers, ms timestamps.
import { describe, it, expect } from 'vitest';
import { rpc } from './lib/stack.js';

export const FISCO_NODES = ['10.88.1.10', '10.88.1.11', '10.88.1.12', '10.88.1.13'].map((ip) => `http://${ip}:8545`);

describe('FISCO chain', () => {
  it('answers on every node with chain id 20200', async () => {
    for (const url of FISCO_NODES) expect(BigInt(await rpc<string>(url, 'eth_chainId'))).toBe(20200n);
  });

  it('node0 is connected to the other sealers', async () => {
    // FISCO's net_peerCount counts the group's nodes, itself included.
    expect(Number(await rpc<string>(FISCO_NODES[0]!, 'net_peerCount'))).toBeGreaterThanOrEqual(3);
  });

  it('the nodes agree on the chain height within a few blocks', async () => {
    const heights = await Promise.all(FISCO_NODES.map(async (u) => Number(await rpc<string>(u, 'eth_blockNumber'))));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  });
});
