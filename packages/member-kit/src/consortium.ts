// FISCO side of a member service: opens proposals with the member's FISCO account and signs them with its Base
// signer key, after recomputing the digest in TS under the configured Base domain and checking the board agrees.
import { decodeEventLog, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fiscoAbis, fiscoClients, sendFisco } from '@praetor/fisco-client';
import { praetorDomain } from '@praetor/protocol';
import type { BoardName, ConsortiumPort } from './app.js';
import { decodeFields } from './proposal.js';

export type ConsortiumAddresses = {
  agentStatus: Address; assetRegistry: Address; sanctionsList: Address; jurisdictionRules: Address; attesterRegistry: Address;
  mandateRegistry: Address; auditLog: Address; baseOutbox: Address; memberRegistry: Address;
};

const BOARD: Record<BoardName, { key: keyof ConsortiumAddresses; abi: Abi }> = {
  status: { key: 'agentStatus', abi: fiscoAbis.AgentStatus as Abi },
  assets: { key: 'assetRegistry', abi: fiscoAbis.AssetRegistry as Abi },
  sanctions: { key: 'sanctionsList', abi: fiscoAbis.SanctionsList as Abi },
  jurisdictions: { key: 'jurisdictionRules', abi: fiscoAbis.JurisdictionRules as Abi },
  attesters: { key: 'attesterRegistry', abi: fiscoAbis.AttesterRegistry as Abi },
  mandates: { key: 'mandateRegistry', abi: fiscoAbis.MandateRegistry as Abi },
  audit: { key: 'auditLog', abi: fiscoAbis.AuditLog as Abi },
};

export class DomainMismatch extends Error {
  status = 409;
}

type Proposal = { kind: number; status: number; nonce: bigint; deadline: bigint; key: Hex; opener: Address; required: number; bankRequired: boolean; hasBank: boolean; fields: Hex; sigs: Hex[]; signers: Address[] };

export class Consortium implements ConsortiumPort {
  readonly pub: PublicClient;
  readonly wallet: WalletClient;

  constructor(private o: { rpcUrl: string; fiscoKey: Hex; baseSignerKey: Hex; addresses: ConsortiumAddresses; domain: { name: string; hook: Address }; baseNow: () => Promise<bigint> }) {
    const c = fiscoClients(o.rpcUrl, o.fiscoKey);
    this.pub = c.pub as PublicClient;
    this.wallet = c.wallet as WalletClient;
  }

  address(board: BoardName): Address {
    return this.o.addresses[BOARD[board].key];
  }

  async deadline(ttlSeconds = 3600): Promise<bigint> {
    const fisco = (await this.pub.readContract({ address: this.address('status'), abi: BOARD.status.abi, functionName: 'chainTimeSeconds' })) as bigint;
    const base = await this.o.baseNow();
    return (fisco > base ? fisco : base) + BigInt(ttlSeconds);
  }

  async open(board: BoardName, fn: string, args: readonly unknown[]) {
    const r = await sendFisco(this.pub, this.wallet, { address: this.address(board), abi: BOARD[board].abi, functionName: fn, args });
    return { proposalId: this.openedId(board, r.logs), digest: (await this.read(board, this.openedId(board, r.logs))).digest, txHash: r.transactionHash };
  }

  async read(board: BoardName, id: bigint) {
    const p = (await this.pub.readContract({ address: this.address(board), abi: BOARD[board].abi, functionName: 'proposal', args: [id] })) as Proposal;
    const d = decodeFields(p.kind, p.fields);
    return {
      id, kind: p.kind, primaryType: d.primaryType, status: p.status, nonce: p.nonce, deadline: p.deadline, required: p.required,
      bankRequired: p.bankRequired, signers: p.signers, message: d.message, fields: p.fields, digest: d.digest(this.domain()),
    };
  }

  async sign(board: BoardName, id: bigint) {
    const p = await this.read(board, id);
    const onChain = (await this.pub.readContract({ address: this.address(board), abi: BOARD[board].abi, functionName: 'digestOf', args: [p.fields, p.kind] })) as Hex;
    if (onChain !== p.digest) throw new DomainMismatch('the board signs under another Base domain than this service');
    const sig = await privateKeyToAccount(this.o.baseSignerKey).sign({ hash: p.digest });
    const r = await sendFisco(this.pub, this.wallet, { address: this.address(board), abi: BOARD[board].abi, functionName: 'sign', args: [id, sig] });
    return { txHash: r.transactionHash, ready: this.hasEvent(board, r.logs, 'Ready') };
  }

  async reissue(board: BoardName, id: bigint) {
    const r = await sendFisco(this.pub, this.wallet, { address: this.address(board), abi: BOARD[board].abi, functionName: 'reissue', args: [id, await this.deadline()] });
    const proposalId = this.openedId(board, r.logs);
    return { proposalId, digest: (await this.read(board, proposalId)).digest, txHash: r.transactionHash };
  }

  /** Bank-only calls that are not proposals (policy check, successor links, owner-action records). */
  async call(board: BoardName, fn: string, args: readonly unknown[]) {
    return sendFisco(this.pub, this.wallet, { address: this.address(board), abi: BOARD[board].abi, functionName: fn, args });
  }

  domain() {
    return praetorDomain(this.o.domain.name, this.o.domain.hook);
  }

  private openedId(board: BoardName, logs: { address: Address; data: Hex; topics: readonly Hex[] }[]): bigint {
    for (const l of logs) {
      try {
        const ev = decodeEventLog({ abi: BOARD[board].abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
        if (ev.eventName === 'ProposalOpened') return (ev.args as unknown as { id: bigint }).id;
      } catch {
        // other events
      }
    }
    throw new Error('no ProposalOpened event in the receipt');
  }

  private hasEvent(board: BoardName, logs: { data: Hex; topics: readonly Hex[] }[], name: string): boolean {
    return logs.some((l) => {
      try {
        return decodeEventLog({ abi: BOARD[board].abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }).eventName === name;
      } catch {
        return false;
      }
    });
  }
}
