import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { concat, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, keccak256, pad, parseAbi, parseAbiParameters, stringToHex, toHex, type Hex } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { encodePasskeySignature, mandateHookEventsAbi, softPasskey } from '@praetor/protocol';
import { encodeExecute } from '@praetor/userop';
import { printableRuns, scanBase, scanBytes, type LogItem, type TxItem } from './i19.js';
import { FIXTURE, M16_TAG, NOT_SEARCHED, SEEDED_VALUES } from './i19-seeded.js';

const root = new URL('../../', import.meta.url);
const bytes = (h: Hex) => Buffer.from(h.slice(2), 'hex');
const stringArg = parseAbi(['function note(string s)', 'function put(bytes32 a, string s, uint256 n)']);
const asCalldata = (s: string): Hex => encodeFunctionData({ abi: stringArg, functionName: 'note', args: [s] });
const rules = (h: Hex) => scanBytes(bytes(h)).map((m) => m.rule);
const tx = (input: Hex, hash: Hex = keccak256(input)): TxItem => ({ hash, to: '0x00000000000000000000000000000000000000aa', input });
const ACC = '0x000000000000000000000000000000000000a11c';
const PAYEE = '0x7b4AFf8c1855724f120BD750A1Df5E4AF7CAE269';

// Deterministic xorshift32: the same "random" corpus on every run.
function prng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
}

describe('printableRuns', () => {
  it('finds ASCII runs of at least the minimum length, with their byte offsets', () => {
    const b = bytes(concat(['0x0001', stringToHex('hello world'), '0x00ff', stringToHex('abc'), '0x00']));
    expect(printableRuns(b, 6)).toEqual([{ text: 'hello world', offset: 2 }]);
  });

  it('keeps valid UTF-8 multibyte characters inside a run (Cafe Lumen with its accent, Chinese)', () => {
    const b = bytes(concat(['0x00', stringToHex('Café Lumen'), '0x00', stringToHex('林伟 商户编号哈希'), '0x00']));
    expect(printableRuns(b, 6).map((r) => r.text)).toEqual(['Café Lumen', '林伟 商户编号哈希']);
  });

  it('breaks runs on invalid UTF-8 and control bytes', () => {
    const b = bytes(concat([stringToHex('abcdef'), '0xc3', stringToHex('ghijkl'), '0x07', stringToHex('mnopqr')]));
    expect(printableRuns(b, 6).map((r) => r.text)).toEqual(['abcdef', 'ghijkl', 'mnopqr']);
  });
});

describe('seeded values', () => {
  it('collects the M16 run person and email (tag recovered offline)', () => {
    const values = SEEDED_VALUES.map((s) => s.value);
    expect(values).toEqual(expect.arrayContaining([`Zqevidence Lin${M16_TAG}`, `EV${M16_TAG}`, `evidence-${M16_TAG}@example.com`, 'Café Lumen', 'KOWLOON-LETTINGS', '1990-04-02', 'Lin Wei', 'K1234567']));
    for (const s of SEEDED_VALUES) expect(s.value.length, s.value).toBeGreaterThanOrEqual(4);
    for (const n of NOT_SEARCHED) expect(values).not.toContain(n);
  });

  it('finds every seeded value ABI-encoded as a string argument', () => {
    for (const s of SEEDED_VALUES) expect(rules(asCalldata(s.value)), s.value).toContain(`seeded:${s.field}`);
  });

  it('finds a seeded value packed into a bytes32 word (an event topic), whatever its case', () => {
    const topic = pad(stringToHex('LIN WEI'), { dir: 'right', size: 32 });
    expect(rules(topic)).toContain('seeded:name');
    const m = scanBytes(bytes(concat([keccak256('0x01'), pad(stringToHex('k1234567'), { dir: 'right', size: 32 })])));
    expect(m).toContainEqual({ rule: 'seeded:document', match: 'k1234567', offset: 32 });
  });

  it('finds the per-run test families: Zq names, tagged document numbers, demoPerson numbers', () => {
    const tag = Date.now().toString(36);
    expect(rules(asCalldata(`Zqf5person Kycname${tag}`))).toContain('family:test person name');
    expect(rules(asCalldata(`Zqrt agentinjection Kycname${tag}`))).toContain('family:test person name');
    expect(rules(asCalldata(`F5${tag}DOC`))).toContain('family:test document number');
    expect(rules(asCalldata(`F10W${tag}`))).toContain('family:test document number');
    expect(rules(asCalldata(`RT${tag}agentinjection`))).toContain('family:test document number');
    expect(rules(asCalldata(`D${keccak256(toHex('label')).slice(2, 10)}`))).toContain('family:test document number (hex)');
    expect(rules(asCalldata(`f1-${tag}@example.com`))).toContain('family:test email');
  });
});

describe('generic patterns (decoded printable runs)', () => {
  it('emails', () => {
    expect(rules(asCalldata('contact: someone.else@mail.example.org'))).toContain('email');
    expect(rules(asCalldata('林伟 <lin.wei@qq.com>'))).toContain('email');
  });

  it('phone numbers with a + prefix or separators', () => {
    expect(rules(asCalldata('tel +852 9123 4567'))).toContain('phone');
    expect(rules(asCalldata('+41791234567'))).toContain('phone');
    expect(rules(asCalldata('call 555-123-4567'))).toContain('phone');
    expect(rules(asCalldata('(555) 123-4567'))).toContain('phone');
  });

  it('birthdates in ISO, European and US formats', () => {
    expect(rules(asCalldata('born 1975-12-31'))).toContain('birthdate');
    expect(rules(asCalldata('dob 31.12.1975'))).toContain('birthdate');
    expect(rules(asCalldata('dob 12/31/1975'))).toContain('birthdate');
    expect(rules(asCalldata('dob 05/06/2001'))).toContain('birthdate');
  });

  it('passport and ID numbers: letters and digits, HKID with its check digit, a mainland resident ID with a valid checksum', () => {
    expect(rules(asCalldata('passport E12345678'))).toContain('id-number');
    expect(rules(asCalldata('HKID A123456(3)'))).toContain('id-number');
    expect(rules(asCalldata('id 11010519491231002X'))).toContain('id-number');
  });

  it('IBANs with a valid mod-97 checksum, grouped or not', () => {
    expect(rules(asCalldata('CH93 0076 2011 6238 5295 7'))).toContain('iban');
    expect(rules(asCalldata('pay GB82WEST12345698765432 now'))).toContain('iban');
  });
});

describe('no false positives', () => {
  it('ignores near misses: bad checksums, bare digit runs, digits inside hex text, dates outside birth years', () => {
    for (const s of [
      'GB00WEST12345698765432', // IBAN checksum fails
      '11010519491231002Y', '110105194912310021', // resident ID checksum fails
      '1234567890123', '20000000000', // amounts as decimal strings: no + and no separators
      '0x7ff83549a3d36b93dfbcafa8feedcf68eeb9ad5f', 'xE12345678y', // digits and IDs glued to letters
      '2026-10-18T05:14:49.180Z', '2031-01-01', // timestamps and future dates
      '1990-13-02', '31.02.1975', // no 13th month, no 31 February
      'Praetor-test', 'Tokenized Gold', 'tXAU', 'Praetor Demo Bank', 'webauthn.get',
    ]) expect(rules(asCalldata(s)), s).toEqual([]);
  });

  it('ignores every hex value of the golden vectors (EIP-712 encodings, payloads, policies, WeCross EVM vectors)', () => {
    const hex: Hex[] = [];
    const walk = (x: unknown): void => {
      if (typeof x === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(x)) hex.push(x as Hex);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    const dir = new URL('packages/protocol/vectors/', root);
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) walk(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    walk(JSON.parse(readFileSync(new URL('wecross/evm-stub/src/test/resources/vectors.json', root), 'utf8')));
    expect(hex.length).toBeGreaterThan(100);
    for (const h of hex) expect(rules(h), h).toEqual([]);
  });

  it('ignores a passkey-signed handleOps bundle: WebAuthn clientDataJSON with its origin and base64url challenge', () => {
    for (const origin of ['https://praetor.localhost', 'https://app.praetor-demo.example']) {
      for (let i = 0; i < 50; i++) {
        const pk = softPasskey(`i19-${i}`, new URL(origin).host, origin);
        const callData = encodeExecute([{ to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [PAYEE, 125_000n * BigInt(i + 1)] }) }]);
        const signature = encodePasskeySignature(pk.credIdHash, pk.sign(keccak256(toHex(`op-${i}`))));
        const op = {
          sender: ACC, nonce: BigInt(keccak256(toHex(i))) >> 64n, initCode: '0x' as Hex, callData, accountGasLimits: pad(toHex(300_000n << 128n | 200_000n)),
          preVerificationGas: 60_000n, gasFees: pad(toHex(1_000_000n << 128n | 1_000_000n)), paymasterAndData: concat(['0x1A5514F4752683b2f7e032c36529260dacf98c94', keccak256(toHex(i)), keccak256(toHex(i + 1000))]), signature,
        } as const;
        const input = encodeFunctionData({ abi: entryPoint07Abi, functionName: 'handleOps', args: [[op], ACC] });
        expect(rules(input), origin).toEqual([]);
      }
    }
  });

  it('ignores the allowed-by-design attributes: KYA with a bytes2 jurisdiction, the ERC-3643 identity country', () => {
    // KYAApplied(address indexed account, address agentKey, uint8 kycLevel, uint8 riskProfile, bytes2 jurisdiction, uint64 validUntil, bytes32 fiscoRef)
    const data = encodeAbiParameters(parseAbiParameters('address, uint8, uint8, bytes2, uint64, bytes32'), ['0x54cE90Fe20029De90aeE9e05079b910e613B09a1', 2, 2, stringToHex('HK', { size: 2 }), 1_831_536_000n, keccak256('0x01')]);
    const topics = encodeEventTopics({ abi: mandateHookEventsAbi, eventName: 'KYAApplied', args: { account: ACC } }) as Hex[];
    const log: LogItem = { address: ACC, transactionHash: keccak256('0x02'), logIndex: 0, topics, data };
    const register = encodeFunctionData({ abi: parseAbi(['function registerIdentity(address wallet, bytes32 identityHash, bytes2 country)']), functionName: 'registerIdentity', args: [ACC, keccak256('0x03'), stringToHex('HK', { size: 2 })] });
    expect(scanBase({ txs: [tx(register)], logs: [log] }).findings).toEqual([]);
  });

  it('ignores random bytes: hashes, addresses, ABI words (a fixed pseudo-random corpus of about 3 MB)', () => {
    const next = prng(19);
    let scanned = 0;
    for (let i = 0; i < 3000; i++) {
      const b = Buffer.alloc(64 + (next() % 1984));
      for (let j = 0; j < b.length; j++) b[j] = next() & 0xff;
      scanned += b.length;
      expect(scanBytes(b), `buffer ${i}`).toEqual([]);
    }
    expect(scanned).toBeGreaterThan(2_500_000);
  });
});

describe('scanBase', () => {
  it('scans transaction calldata, log topics and log data, and says where each finding is', () => {
    const leak = encodeFunctionData({ abi: stringArg, functionName: 'put', args: [keccak256('0x01'), 'Lin Wei, born 1990-04-02', 7n] });
    const clean = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [PAYEE, 1_000_000n] });
    const logs: LogItem[] = [
      { address: ACC, transactionHash: keccak256('0x0a'), logIndex: 3, topics: [keccak256('0x0b'), pad(stringToHex('Zqf1person Onboard'), { dir: 'right', size: 32 })], data: '0x' },
      { address: ACC, transactionHash: keccak256('0x0a'), logIndex: 4, topics: [keccak256('0x0b')], data: encodeAbiParameters([{ type: 'string' }], ['x@example.com']) },
    ];
    const r = scanBase({ txs: [tx(leak, keccak256('0x0c')), tx(clean)], logs });
    expect(r.txs).toBe(2);
    expect(r.logs).toBe(2);
    expect(r.bytes).toBe(bytes(leak).length + bytes(clean).length + 64 + bytes(logs[1]!.data).length + 32);
    const where = r.findings.map((f) => `${f.where} ${f.rule}`);
    expect(where).toEqual(expect.arrayContaining([
      `tx ${keccak256('0x0c')} input seeded:name`, `tx ${keccak256('0x0c')} input seeded:birthdate`, `tx ${keccak256('0x0c')} input birthdate`,
      `log ${keccak256('0x0a')}#3 topic1 family:test person name`, `log ${keccak256('0x0a')}#4 data seeded:email`, `log ${keccak256('0x0a')}#4 data email`,
    ]));
    expect(r.findings.every((f) => !f.where.startsWith(`tx ${keccak256(clean)}`))).toBe(true);
    expect(FIXTURE.values.length).toBeGreaterThan(30);
  });
});
