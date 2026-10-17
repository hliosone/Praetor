// The single authentication entry WeIdentity writes for a key on createWeIdWithPubKey:
// "<weid>#keys-<8 hex>,Ed25519VerificationKey2020,<weid>,z<base58btc(ed 01 01 || decimal public key)>"
// (read back from WeIdContract.resolve; the type label is WeIdentity's, the key is secp256k1). sign-weid accepts a
// document whose authentication is exactly this entry, so the bank can never make the agent sign away its DID.
import type { Hex } from 'viem';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(b: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(b).toString('hex') || '0'}`);
  let s = '';
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = `1${s}`;
  }
  return s;
}

/** publicKey: the uncompressed 0x04 || X || Y key. */
export function weidKeyMultibase(publicKey: Hex): string {
  const decimal = BigInt(`0x${publicKey.slice(4)}`).toString();
  return `z${base58(new Uint8Array([0xed, 0x01, 0x01, ...Buffer.from(decimal, 'utf8')]))}`;
}

export function isOwnAuthentication(entries: string[], weid: string, publicKey: Hex): boolean {
  if (entries.length !== 1) return false;
  const [id, type, controller, key, ...rest] = entries[0]!.split(',');
  return rest.length === 0 && new RegExp(`^${weid}#keys-[0-9a-f]{8}$`).test(id ?? '') && type === 'Ed25519VerificationKey2020' && controller === weid && key === weidKeyMultibase(publicKey);
}
