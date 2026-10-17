// Owner recovery by the bank (spec 06 F10 step 6, spec 05): after its own re-KYC matched the issued record, the bank
// alone schedules a SET_OWNER_KEY for the user's new passkey. The hook applies it after 48 h unless any remaining
// passkey cancels it, keeps the account RESTRICTED meanwhile, and the bank tells the user through its own channel.
import { randomBytes } from 'node:crypto';
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { digest, praetorDomain, OwnerActionKind as K, ZERO_HASH, type OwnerAction } from '@praetor/protocol';
import type { OwnerKey } from './kyc.js';

const VALIDITY_S = 3600n;

export class RecoveryService {
  constructor(private readonly d: {
    domain: { name: string; hook: Address };
    bankSignerKey: Hex;
    now(): Promise<bigint>;
    schedule(a: OwnerAction, payload: Hex, bankSigs: Hex[]): Promise<Hex>;
    notify(account: Address, text: string): Promise<void>;
  }) {}

  async schedule(account: Address, key: OwnerKey): Promise<Hex> {
    const payload = encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [key.credIdHash as Hex, BigInt(key.x), BigInt(key.y)]);
    const a: OwnerAction = {
      account, action: K.SET_OWNER_KEY, payloadHash: keccak256(payload),
      nonce: BigInt(`0x${randomBytes(8).toString('hex')}`), expiresAt: (await this.d.now()) + VALIDITY_S, fiscoRef: ZERO_HASH,
    };
    const sig = await privateKeyToAccount(this.d.bankSignerKey).sign({ hash: digest(praetorDomain(this.d.domain.name, this.d.domain.hook), 'OwnerAction', a) });
    const tx = await this.d.schedule(a, payload, [sig]);
    await this.d.notify(account, 'recovery scheduled: your keys will be replaced in 48 h unless you cancel it with one of your passkeys');
    return tx;
  }
}
