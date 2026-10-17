import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { weidKeyMultibase, isOwnAuthentication } from '../src/weid.js';

// Read from WeIdContract.resolve after REST createWeIdWithPubKey for this fixed test key (2026-10-17, local chain).
const VECTOR = 'did:weid:101:0x320c82db95d7c598d1e6eab6b57443608ce8bada#keys-64cffb1a,Ed25519VerificationKey2020,did:weid:101:0x320c82db95d7c598d1e6eab6b57443608ce8bada,z5rrf3w1M7R2SE6u1BvwPeEEY6zdkQwvopPiDCKacCp3nvQ25eVS9H1fDt9W2GuYsPDj7pJQyz2ncoQ7iR5pvbFnyBLCM5FKF35ycA4xV5DwyZFqytHY295yqzTVLkQrSn2FgRK5fnZzJKfEv6WTTE7jj5ekMopnoVHL294XohBhE4f7qTvoEyQbxzdL7zUffV5Hj1mt7iWZtpgJFCCkun2u';
const acc = privateKeyToAccount(keccak256(toHex('praetor-weid-auth-vector')));
const weid = `did:weid:101:${acc.address.toLowerCase()}`;

describe('agent DID authentication entry', () => {
  it('encodes the public key the way WeIdentity does (multibase z + base58 of ed 01 01 and the decimal key)', () => {
    expect(VECTOR.split(',')[3]).toBe(weidKeyMultibase(acc.publicKey));
  });
  it('accepts exactly the entry createWeIdWithPubKey wrote for this key', () => {
    expect(isOwnAuthentication([VECTOR], weid, acc.publicKey)).toBe(true);
  });
  it('refuses a second entry, another key under our controller, another controller, or no entry', () => {
    const other = privateKeyToAccount(keccak256(toHex('someone-else')));
    const parts = VECTOR.split(',');
    expect(isOwnAuthentication([VECTOR, VECTOR], weid, acc.publicKey)).toBe(false);
    expect(isOwnAuthentication([[parts[0], parts[1], parts[2], weidKeyMultibase(other.publicKey)].join(',')], weid, acc.publicKey)).toBe(false);
    expect(isOwnAuthentication([[parts[0], parts[1], 'did:weid:101:0x00000000000000000000000000000000000000ba', parts[3]].join(',')], weid, acc.publicKey)).toBe(false);
    expect(isOwnAuthentication([], weid, acc.publicKey)).toBe(false);
  });
});
