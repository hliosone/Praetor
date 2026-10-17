// Account fixtures of the red-team suite: fresh accounts onboarded through the member services like the seed does
// (scripts/demo/lib.ts), one per group of cases so state-changing attacks never share an account, plus the
// placeholder values of each case. Accounts are new on every run (label = run tag); suite-owned consortium records
// (a sanctioned address, a delisted dummy token, a suspended dummy partner) are made once and reused.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, pad, parseAbiItem, toHex, zeroAddress, type Address, type Hex } from 'viem';
import { MandateHookAbi, PriceOracleAbi, baseNow, loadDeployments } from '@praetor/chain';
import {
  OwnerActionKind as K, ZERO_HASH, digest, merchantRef, ownerActionPayload, passkeyAuth, praetorDomain, softPasskey, soterChallenge, type Policy, type SoterApproval,
} from '@praetor/protocol';
import { fakeSoterSignature } from '@praetor/soter-attester';
import { ENTRY_POINT } from '@praetor/userop';
import {
  PARTNER, activateSoterAttester, attesterCall, bundler, createAccount, fund, http2, kycViaVendor, labelAddress, linPolicy, onboard, openAndSign, pub, root,
  scriptAgent, setPayeeLabels, stack, waitFor, type Account, type Stack,
} from '../../../scripts/demo/lib.js';
import { WebClient, onboardViaApi, policyJson } from '../../../scripts/demo/web.js';
import type { Case, Driver } from './case.js';
import type { Vars } from './resolve.js';
import type { Chain } from './chain.js';
import type { FixtureName } from './names.js';

export const runTag = process.env.REDTEAM_TAG ?? Date.now().toString(36);
/** The checkout whose stack runs (its .env and deployments); the repo root unless PRAETOR_STACK_ROOT says otherwise. */
export const stackRoot = `${(process.env.PRAETOR_STACK_ROOT ?? root).replace(/\/$/, '')}/`;
export const URLS = {
  api: process.env.API_URL_HOST ?? 'http://10.88.0.80:3200',
  mcp: process.env.MCP_URL_HOST ?? 'http://10.88.0.60:3080',
  web: process.env.WEB_URL ?? 'https://praetor.localhost',
};

export function redteamStack(): Stack {
  return stack({ base: loadDeployments(`${stackRoot}infra/deployments/fork.json`) });
}

export type Person = { fullName: string; birthdate: string; nationality: string; documentNumber: string };
export type Phone = { code: string; uid: string; cpu: string };
export type Fixture = { name: string; driver: Driver; acc: Account; vars: Vars; person?: Person; web?: WebClient; phone?: Phone };

type Recipe = { kind: 'lib' | 'web' | 'bare'; funded?: boolean; frozen?: boolean; soter?: boolean; nationality?: string; policy?: (p: Policy) => Policy };
const LIB: Recipe = { kind: 'lib', funded: true };
const RECIPES: Record<Exclude<FixtureName, 'fresh'>, Recipe> = {
  main: LIB, 'inj-a': LIB, 'inj-b': LIB, 'inj-label': LIB, limits: LIB, split: LIB, budget: LIB, swaps: LIB, rebalance2: LIB, shape: LIB, owner: LIB,
  approvals: LIB, payouts: LIB, standing: LIB,
  count: { ...LIB, policy: (p) => ({ ...p, dailyCount: 2 }) },
  frozen: { ...LIB, frozen: true },
  soter: { ...LIB, soter: true },
  cn: { ...LIB, nationality: 'CN' },
  web: { kind: 'web', funded: true },
  bare: { kind: 'bare' },
};

const u64 = () => BigInt(keccak256(toHex(`${Date.now()}-${Math.random()}`))) % 2n ** 64n;

export class Fixtures {
  private built = new Map<string, Promise<Fixture>>();
  private globals = new Map<string, Promise<Address>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly s: Stack, readonly chain: Chain) {}

  /** One fixture per (driver, name); `fresh` is new for each case. */
  get(name: string, driver: Driver, caseId: string): Promise<Fixture> {
    const key = name === 'fresh' ? `${driver}:fresh:${caseId}` : `${driver}:${name}`;
    let f = this.built.get(key);
    if (!f) {
      f = this.build(name, driver, key);
      f.catch(() => undefined);
      this.built.set(key, f);
    }
    return f;
  }

  /** Transactions from shared EOAs (USDC master minter, desk operator) one at a time. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private labels(): { address: Address; label: string }[] {
    return [{ address: labelAddress('landlord'), label: 'Landlord' }, { address: labelAddress('utilities'), label: 'Utilities' }, { address: labelAddress('cafe'), label: 'Café Lumen' }];
  }

  /** The owner's payee names (stored in mcp, as the api does), defaults first, then these. */
  async setLabels(account: Address, extra: { address: Address; label: string }[]) {
    const all = new Map(this.labels().map((l) => [l.address.toLowerCase(), l]));
    for (const l of extra) all.set(l.address.toLowerCase(), l);
    await setPayeeLabels(this.s, account, [...all.values()]);
  }

  private async build(name: string, driver: Driver, key: string): Promise<Fixture> {
    const r = RECIPES[(name === 'fresh' ? 'main' : name) as Exclude<FixtureName, 'fresh'>];
    if (!r) throw new Error(`unknown fixture ${name}`);
    const label = `rt-${key.replace(/[^A-Za-z0-9-]/g, '-')}-${runTag}`;
    const person: Person = {
      fullName: `Zqrt ${name.replace(/[^A-Za-z]/g, '')} Kycname${runTag}`, birthdate: '1979-11-23', nationality: r.nationality ?? 'HK',
      documentNumber: `RT${runTag}${name.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40),
    };
    if (r.kind === 'bare') {
      const address = labelAddress(label);
      return { name, driver, acc: { address, owner: softPasskey(label, this.s.rpId, this.s.origin), agent: zeroAddress }, vars: this.baseVars(address, zeroAddress) };
    }
    if (r.kind === 'web') return this.buildWeb(name, driver, label, person);
    const acc = await createAccount(this.s, label);
    const userRef = `rt-${label}`;
    await kycViaVendor(this.s, userRef, acc.address, person);
    const base = linPolicy(this.s, 0n);
    await onboard(this.s, acc, r.policy ? r.policy(base) : base, { userRef });
    // A scheduler wake must never have the real model act on a scripted account (F9).
    if (driver === 'scripted') await scriptAgent(this.s, acc.address, []);
    if (r.funded) await this.serial(() => fund(this.s, acc));
    await this.setLabels(acc.address, []);
    let phone: Phone | undefined;
    if (r.soter) {
      phone = { code: `rt-${runTag}-phone1`, uid: `uid-rt-${runTag}`, cpu: `cpu-rt-${runTag}` };
      await this.linkWechat(acc, phone);
    }
    if (r.frozen) {
      await openAndSign(this.s, 'regulator', '/status', { account: acc.address, status: 2 }, ['regulator']);
      await waitFor('fixture FROZEN on Base', async () => (await this.chain.hook<readonly [number]>('statusOf', [acc.address]))[0] === 2, 180_000);
    }
    return { name, driver, acc, person, phone, vars: this.baseVars(acc.address, acc.agent) };
  }

  /** F1 through the api with the software passkey (signed-in session, CSRF cookie), then the policy and funds. */
  private async buildWeb(name: string, driver: Driver, label: string, person: Person): Promise<Fixture> {
    const web = new WebClient(this.s, label, URLS.api);
    const agent = await onboardViaApi(web, label, person);
    const p = { ...linPolicy(this.s, 0n), validUntil: (await baseNow(pub(this.s))) + 31_536_000n };
    const prop = await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) });
    if (!(await web.ownerAction(prop)).success) throw new Error('web fixture: policy not set');
    const acc: Account = { address: web.account!, owner: web.passkey, agent };
    await this.serial(() => fund(this.s, acc));
    await this.setLabels(acc.address, []);
    return { name, driver, acc, person, web, vars: this.baseVars(acc.address, agent) };
  }

  /** The attester TEE signs a SoterApproval for the phone's (fake Tencent) SOTER result over `d`, as the api asks it. */
  async soterSign(account: Address, d: Hex, phone: Phone, counter: number, expiresAt: bigint): Promise<{ proof: SoterApproval; attesterSig: Hex }> {
    const resultJSON = JSON.stringify({ raw: soterChallenge(d), counter, uid: phone.uid, cpu_id: phone.cpu });
    const r = await attesterCall(this.s, '/v1/soter/approve', {
      code: phone.code, account, digestHex: d.slice(2), expiresAt: Number(expiresAt), authMode: 'facial', resultJSON, resultJSONSignature: fakeSoterSignature(`openid-of-${phone.code}`, resultJSON),
    });
    if (r.status !== 200) throw new Error(`attester: ${r.status} ${JSON.stringify(r.body)}`);
    const sa = r.body.soterApproval as Record<string, string>;
    return {
      proof: { account: sa.account as Address, digest: sa.digest as Hex, bindingHash: sa.bindingHash as Hex, soterCounter: BigInt(sa.soterCounter!), expiresAt: BigInt(sa.expiresAt!) },
      attesterSig: r.body.attesterSig as Hex,
    };
  }

  /** LINK_WECHAT (F2) without the mini program: passkey + bank, with the attester's proof of the phone's SOTER key. */
  private async linkWechat(acc: Account, phone: Phone) {
    const { attester } = (await attesterCall(this.s, '/v1/info')).body as { attester: Address };
    if (!(await this.chain.hook<readonly [Hex, boolean]>('attesterOf', [attester]))[1]) await activateSoterAttester(this.s);
    const now = await this.chain.now();
    const linkNonce = keccak256(toHex(`rt-link:${acc.address}:${runTag}`));
    const a = { account: acc.address, action: K.LINK_WECHAT, payloadHash: keccak256(encodeAbiParameters([{ type: 'bytes32' }], [linkNonce])), nonce: u64(), expiresAt: now + 600n, fiscoRef: ZERO_HASH };
    const d = digest(praetorDomain(this.s.base.domainName, this.s.base.mandateHook), 'OwnerAction', a);
    const { proof, attesterSig } = await this.soterSign(acc.address, d, phone, 1, now + 600n);
    const { payload } = ownerActionPayload({ kind: K.LINK_WECHAT, account: acc.address, linkNonce, proof, attesterSig });
    const cos = await http2(`${this.s.members.bank}/owner-actions/cosign`, this.s.env.INTERNAL_TOKEN_MEMBERS!, { ownerAction: a, payload });
    if (cos.status !== 200) throw new Error(`bank co-signature of LINK_WECHAT: ${cos.status} ${JSON.stringify(cos.body)}`);
    const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'applyOwnerAction', args: [a, payload, passkeyAuth(acc.owner.credIdHash, acc.owner.sign(d)), [cos.body.bankSig as Hex]] });
    const r = await bundler(this.s, '/tx', { to: this.s.base.mandateHook, data });
    if (!r.body?.success) throw new Error(`LINK_WECHAT refused: ${JSON.stringify(r.body)}`);
  }

  private baseVars(account: Address, agent: Address): Vars {
    const b = this.s.base;
    return {
      account, agent, usdc: b.usdc, txau: b.txau, txag: b.txag, desk: b.treasuryDesk, rail: b.payoutRail, partner: PARTNER(this.s), hook: b.mandateHook,
      refusalLog: b.refusalLog, standingOrders: b.standingOrders, entryPoint: ENTRY_POINT, agentValidator: b.agentKeyValidator, passkeyValidator: b.passkeyValidator,
      noOwner: b.noOwner, landlord: labelAddress('landlord'), utilities: labelAddress('utilities'), cafe: labelAddress('cafe'),
      merchantKowloon: merchantRef('KOWLOON-LETTINGS'), zeroAddress, apiUrl: URLS.api, mcpUrl: URLS.mcp, webUrl: URLS.web,
    };
  }

  /** Per-case values: attacker addresses of this case, the account's nonces, prices, and suite-owned records when used. */
  async caseVars(fx: Fixture, c: Case): Promise<Vars> {
    const used = new Set((JSON.stringify([c.setup, c.input]).match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? []).map((p) => p.slice(1)));
    const tag = `${c.id}-${fx.driver}-${runTag}`;
    const attacker = labelAddress(`rt-attacker-${tag}`);
    const transferToAttacker = encodeFunctionData({ abi: [parseAbiItem('function transfer(address,uint256)')], functionName: 'transfer', args: [attacker, 1_000_000n] });
    const v: Vars = {
      ...fx.vars, attacker, attacker2: labelAddress(`rt-attacker2-${tag}`), paymentRef: keccak256(toHex(`rt-payment-${tag}`)),
      statusNonce: String(await this.chain.hook<bigint>('nonces', [0, pad(fx.acc.address)])),
      transferToAttacker, packedTransferToAttacker: encodePacked(['address', 'uint256', 'bytes'], [this.s.base.usdc, 0n, transferToAttacker]),
      // A Safe contract signature (v = 0) naming NoOwner, the account's only Safe owner, with empty signature data.
      noOwnerSig: concat([pad(this.s.base.noOwner), pad(toHex(65)), '0x00', pad('0x00')]),
    };
    if (used.has('sanctioned') || used.has('sanctionNonce')) {
      v.sanctioned = await this.global('sanctioned');
      v.sanctionNonce = String(await this.chain.hook<bigint>('nonces', [4, pad(v.sanctioned as Address)]));
    }
    if (used.has('unlistedToken')) v.unlistedToken = labelAddress('rt-unlisted-token');
    if (used.has('delistedToken')) v.delistedToken = await this.global('delistedToken');
    if (used.has('suspendedPartner')) v.suspendedPartner = await this.global('suspendedPartner');
    if (used.has('xau100')) {
      const [price8] = (await this.chain.p.readContract({ address: this.s.base.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [this.s.base.txau] })) as readonly [bigint, bigint];
      v.xau100 = String((100_000_000n * 10n ** 20n) / price8);
    }
    return v;
  }

  /** Suite-owned consortium records on addresses nobody else uses, made once (additive, never on a shared key, D61). */
  global(name: 'sanctioned' | 'delistedToken' | 'suspendedPartner'): Promise<Address> {
    let g = this.globals.get(name);
    if (!g) {
      g = this.makeGlobal(name);
      g.catch(() => undefined);
      this.globals.set(name, g);
    }
    return g;
  }

  private async makeGlobal(name: 'sanctioned' | 'delistedToken' | 'suspendedPartner'): Promise<Address> {
    const s = this.s;
    const asset = async (a: Address) => (await this.chain.hook<readonly [number, number, number, bigint]>('assetOf', [a]))[1];
    if (name === 'sanctioned') {
      const target = labelAddress('rt-sanctioned');
      if (!(await this.chain.hook<boolean>('isSanctioned', [target]))) {
        await openAndSign(s, 'regulator', '/sanctions', { target, listed: true }, ['regulator']);
        await waitFor('sanction on Base', () => this.chain.hook<boolean>('isSanctioned', [target]), 180_000);
      }
      return target;
    }
    const [label, kind, maxW, final] = name === 'delistedToken' ? ['rt-dummy-token', 0, 1000, 3] : ['rt-dummy-partner', 2, 0, 2];
    const a = labelAddress(label as string);
    if ((await asset(a)) === 0) {
      await openAndSign(s, 'bank', '/assets', { asset: a, kind, status: 1, maxWeightBps: maxW }, ['bank']);
      await waitFor(`${label} active on Base`, async () => (await asset(a)) === 1, 180_000);
    }
    if ((await asset(a)) !== final) {
      await openAndSign(s, 'operator', '/assets', { asset: a, kind, status: final, maxWeightBps: 0 }, ['operator']);
      await waitFor(`${label} status ${final} on Base`, async () => (await asset(a)) === final, 180_000);
    }
    return a;
  }

  /** An owner action of this fixture (passkey, plus the bank's co-signature when `bank`), as calldata for the hook. */
  async ownerActionData(fx: Fixture, args: Parameters<typeof ownerActionPayload>[0], bank: boolean): Promise<{ data: Hex; bankError?: string }> {
    const { payload, payloadHash } = ownerActionPayload(args);
    const a = { account: fx.acc.address, action: args.kind, payloadHash, nonce: u64(), expiresAt: (await this.chain.now()) + 600n, fiscoRef: ZERO_HASH };
    const d = digest(praetorDomain(this.s.base.domainName, this.s.base.mandateHook), 'OwnerAction', a);
    let bankSigs: Hex[] = [];
    let bankError: string | undefined;
    if (bank) {
      const r = await http2(`${this.s.members.bank}/owner-actions/cosign`, this.s.env.INTERNAL_TOKEN_MEMBERS!, { ownerAction: a, payload });
      if (r.status === 200) bankSigs = [r.body.bankSig as Hex];
      else bankError = `${r.status} ${JSON.stringify(r.body)}`;
    }
    return { data: encodeFunctionData({ abi: MandateHookAbi, functionName: 'applyOwnerAction', args: [a, payload, passkeyAuth(fx.acc.owner.credIdHash, fx.acc.owner.sign(d)), bankSigs] }), bankError };
  }
}
