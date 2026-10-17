// M12 link: FISCO -> WeCross -> Base. A consortium decision Ready on FISCO is requested from WeCross by the router's own
// FISCO account (BaseOutbox.requestWeCross), the WeCross router picks it up from the hub and calls Base through
// Praetor's EVM stub: WeCrossProxy -> WeCrossInbox -> MandateHook.applyStatus, signed by the WeCross Base account.
// Needs the stack with BRIDGE=wecross (the relayer then only requests, and delivers after BRIDGE_WATCHDOG_S).
import { describe, it, expect, beforeAll } from 'vitest';
import { parseAbiItem, type Address } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { ROUTER, login, router } from '../../scripts/wecross/router.js';
import { addressOf, bootstrapConsortium, labelAddress, localKey, openAndSign, pub, stack, waitFor, type Stack } from '../../scripts/demo/lib.js';

let s: Stack;
const STATUS_APPLIED = parseAbiItem('event StatusApplied(address indexed account, uint8 status, uint64 nonce, bytes32 fiscoRef, uint8 signerCount)');

beforeAll(async () => { s = stack(); await bootstrapConsortium(s); }, 600_000);

describe('WeCross transport (BRIDGE=wecross)', () => {
  it('the router is up with the FISCO hub and the Base inbox as resources', async () => {
    expect((await fetch(`${ROUTER}/sys/test`).then((r) => r.json())).errorCode).toBe(0);
    const credential = await login('org1-admin', s.env.WECROSS_ADMIN_PASSWORD!);
    const paths = JSON.stringify(await router('POST', '/sys/listResources', { ignoreRemote: false }, credential));
    expect(paths).toContain('payment.base.inbox');
    expect(paths).toContain('payment.fisco.WeCrossHub');
  });

  it('a freeze decided on FISCO reaches Base through WeCross within 60 s, sent by the WeCross Base account to its proxy', async () => {
    const account = labelAddress(`wecross-${Date.now()}`) as Address;
    const t0 = Date.now();
    expect((await openAndSign(s, 'regulator', '/status', { account, status: 2 }, ['regulator'])).ready).toBe(true);
    const log = await waitFor('StatusApplied on Base', async () => {
      const logs = await pub(s).getLogs({ address: s.base.mandateHook, event: STATUS_APPLIED, args: { account }, fromBlock: BigInt(s.base.deployBlock), toBlock: 'latest' });
      return logs[0];
    }, 60_000);
    expect(Date.now() - t0).toBeLessThan(60_000);
    const tx = await pub(s).getTransaction({ hash: log.transactionHash! });
    expect(tx.from.toLowerCase()).toBe(addressOf(localKey(s, 'WECROSS_BASE_KEY')).toLowerCase());
    expect(tx.to?.toLowerCase()).toBe(s.base.wecrossProxy!.toLowerCase());
    expect((await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'statusOf', args: [account] }))[0]).toBe(2);
  }, 120_000);
});
