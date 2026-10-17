// The EIP-712 hashing of packages/protocol (spec 02) that the mini program needs to recompute what it approves: the
// call hash, the Tier2Approval and OwnerAction digests, the LINK_WECHAT / UNLINK_WECHAT payload hashes and the SOTER
// challenge. Written for WeChat's JavaScript engines: keccak from @noble/hashes, hand-rolled ABI words, no BigInt
// literal (Babel and older engines reject them; BigInt() calls are fine), no TextEncoder, no Buffer. Bundled to
// miniprogram/lib/protocol.js by scripts/build-protocol.mjs; DevTools must not transpile that file (ES6 to ES5 off).
import { keccak_256 } from '@noble/hashes/sha3';

export const CHAIN_ID = 84532;

// Values from spec 02 (OwnerActionKind), for the screens and the checks.
export const OwnerActionKind = {
  SET_POLICY: 0, ADD_STANDING_ORDER: 1, CANCEL_STANDING_ORDER: 2, LINK_WECHAT: 3, UNLINK_WECHAT: 4, SET_AGENT_KEY: 5,
  REVOKE_AGENT_KEY: 6, PAUSE_AGENT: 7, RESUME_AGENT: 8, SET_OWNER_KEY: 9, CANCEL_RECOVERY: 10, MODULE_CHANGE: 11, REMOVE_PAYEE: 12,
};

// Exact type strings of spec 02: the field order is part of every hash.
const TYPES = {
  Tier2Approval: [['address', 'account'], ['bytes32', 'callHash'], ['uint64', 'nonce'], ['uint64', 'expiresAt']],
  OwnerAction: [['address', 'account'], ['uint8', 'action'], ['bytes32', 'payloadHash'], ['uint64', 'nonce'], ['uint64', 'expiresAt'], ['bytes32', 'fiscoRef']],
};
const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';

const HEX = /^0x([0-9a-fA-F]{2})*$/;

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex)) throw new Error('not 0x-prefixed hex of whole bytes');
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

export function bytesToHex(bytes) {
  let s = '0x';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

// UTF-8 by hand: the mini program runtime has no TextEncoder.
function utf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function keccak256(data) {
  return bytesToHex(keccak_256(typeof data === 'string' ? hexToBytes(data) : data));
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function wordAddress(a) {
  if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('not an address');
  const w = new Uint8Array(32);
  w.set(hexToBytes(a), 12);
  return w;
}

function wordBytes32(h) {
  const b = hexToBytes(h);
  if (b.length !== 32) throw new Error('not 32 bytes');
  return b;
}

// Decimal strings (how the api sends uint64 and uint256), safe integers or BigInt values; refused outside [0, 2^bits).
function wordUint(v, bits) {
  let n;
  if (typeof v === 'bigint') n = v;
  else if (typeof v === 'number' && Number.isSafeInteger(v)) n = BigInt(v);
  else if (typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v)) n = BigInt(v);
  else throw new Error('not an unsigned integer');
  if (n < BigInt(0) || n >= BigInt(1) << BigInt(bits)) throw new Error(`out of range for uint${bits}`);
  return hexToBytes(`0x${n.toString(16).padStart(64, '0')}`);
}

function word(type, v) {
  if (type === 'address') return wordAddress(v);
  if (type === 'bytes32') return wordBytes32(v);
  const m = /^uint(\d+)$/.exec(type);
  if (m) return wordUint(v, Number(m[1]));
  throw new Error(`no encoder for ${type}`);
}

function fields(type) {
  const f = TYPES[type];
  if (!f) throw new Error(`unknown type ${type}`);
  return f;
}

export const encodeType = (type) => `${type}(${fields(type).map(([t, n]) => `${t} ${n}`).join(',')})`;
export const typehash = (type) => keccak256(utf8(encodeType(type)));

function encodedFields(type, message) {
  return concat(fields(type).map(([t, n]) => {
    if (message == null || !(n in message)) throw new Error(`missing ${n}`);
    return word(t, message[n]);
  }));
}

/** abi.encode of the fields, without the typehash (the "encoded" of the vectors). */
export const encodeStruct = (type, message) => bytesToHex(encodedFields(type, message));
export const structHash = (type, message) => keccak256(concat([hexToBytes(typehash(type)), encodedFields(type, message)]));

export function domainSeparator(d) {
  return keccak256(concat([
    hexToBytes(keccak256(utf8(DOMAIN_TYPE))), hexToBytes(keccak256(utf8(d.name))), hexToBytes(keccak256(utf8(d.version))),
    wordUint(d.chainId, 256), wordAddress(d.verifyingContract),
  ]));
}

export function digest(domain, type, message) {
  return keccak256(concat([new Uint8Array([0x19, 0x01]), hexToBytes(domainSeparator(domain)), hexToBytes(structHash(type, message))]));
}

/** keccak256(abi.encode(account, 84532, target, value, keccak256(data))): binds a human approval to one exact call. */
export function callHash(c) {
  return keccak256(concat([wordAddress(c.account), wordUint(CHAIN_ID, 256), wordAddress(c.target), wordUint(c.value, 256), hexToBytes(keccak256(c.data))]));
}

/** LINK_WECHAT payloadHash = keccak256(abi.encode(bytes32 linkNonce)). */
export const linkPayloadHash = (linkNonce) => keccak256(wordBytes32(linkNonce));
/** UNLINK_WECHAT payloadHash = keccak256(abi.encode(bytes32 bindingHash)). */
export const unlinkPayloadHash = (bindingHash) => keccak256(wordBytes32(bindingHash));

/** The challenge WeChat SOTER signs: the digest as 64 lowercase hex characters, no 0x. */
export const soterChallenge = (d) => bytesToHex(wordBytes32(d)).slice(2);

export const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** EIP-55 mixed-case form, so an address decoded from calldata reads exactly as the web app shows it. */
export function checksumAddress(a) {
  wordAddress(a);
  const lower = a.slice(2).toLowerCase();
  const h = keccak256(utf8(lower)).slice(2);
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}
