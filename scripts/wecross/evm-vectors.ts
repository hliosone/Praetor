// Golden vectors for the WeCross EVM stub (wecross/evm-stub): ABI encodings, decodings and a signed legacy EIP-155
// transaction computed with viem, which the Java code must reproduce byte for byte. The key is derived from a label.
// Usage: pnpm tsx scripts/wecross/evm-vectors.ts > wecross/evm-stub/src/test/resources/vectors.json
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, serializeTransaction, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createPrivateKey } from 'node:crypto';

const abi = parseAbi([
  'function deliver(string[] args) returns (string[])',
  'function sendTransaction(string _uid, string _name, bytes _argsWithMethodId) returns (bytes)',
  'function constantCall(string _name, bytes _argsWithMethodId) returns (bytes)',
  'function getXATransactionState(string _path) view returns (string)',
]);
const KEY_LABEL = 'praetor-wecross-evm-stub-test';
const key = keccak256(toHex(KEY_LABEL)) as Hex;
const account = privateKeyToAccount(key);
const deliverArgs = ['Status', `0x${'ab'.repeat(40)}`, '7'];
const deliver = encodeFunctionData({ abi, functionName: 'deliver', args: [deliverArgs] });
const tx = { type: 'legacy' as const, chainId: 84532, nonce: 5, gasPrice: 1_000_000_000n, gas: 300_000n, to: '0x00000000000000000000000000000000000c0ffe' as Hex, value: 0n, data: deliver };
const signed = await account.signTransaction(tx);

// The account manager stores chain account keys as PEM (PKCS#8 from Node, the format scripts/wecross uses).
const b64u = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');
const pub = account.publicKey;
const pem = createPrivateKey({ key: { kty: 'EC', crv: 'secp256k1', d: b64u(key), x: b64u(`0x${pub.slice(4, 68)}`), y: b64u(`0x${pub.slice(68)}`) }, format: 'jwk' })
  .export({ type: 'pkcs8', format: 'pem' }) as string;

console.log(JSON.stringify({
  // The test key is keccak256 of this public label (no key material in the repo).
  keyLabel: KEY_LABEL,
  address: account.address,
  publicKey: account.publicKey,
  keccakOfHello: keccak256(toHex('hello')),
  pkcs8Pem: pem,
  deliver: { args: deliverArgs, data: deliver },
  sendTransaction: { uid: 'uid-1', name: 'inbox', inner: deliver, data: encodeFunctionData({ abi, functionName: 'sendTransaction', args: ['uid-1', 'inbox', deliver] }) },
  constantCall: { name: 'inbox', inner: deliver, data: encodeFunctionData({ abi, functionName: 'constantCall', args: ['inbox', deliver] }) },
  getXATransactionState: { path: 'payment.base.inbox', data: encodeFunctionData({ abi, functionName: 'getXATransactionState', args: ['payment.base.inbox'] }) },
  returns: {
    stringNull: encodeAbiParameters([{ type: 'string' }], ['null']),
    stringArray: encodeAbiParameters([{ type: 'string[]' }], [['ok', '7']]),
    bytesOfStringArray: encodeAbiParameters([{ type: 'bytes' }], [encodeAbiParameters([{ type: 'string[]' }], [['ok', '7']])]),
  },
  legacyTx: { ...tx, gasPrice: tx.gasPrice.toString(), gas: tx.gas.toString(), value: '0', signed },
}, null, 2));
