// The approval page shows the call the owner's signature binds (its callHash), never another call of the batch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { encodeFunctionData, erc20Abi, parseAbi, type Hex } from 'viem';
import { callHash, digest, praetorDomain } from '@praetor/protocol';
import { I18nProvider } from '../i18n/index.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as const;
const CFG = { chainId: 84532, domainName: 'Praetor-test', mandateHook: '0x00000000000000000000000000000000000000b0', usdc: '0x00000000000000000000000000000000000000a1', txau: '0x00000000000000000000000000000000000000a2', txag: '0x00000000000000000000000000000000000000a3', deskSpreadBps: 30 } as const;
const DESK = '0x00000000000000000000000000000000000000d5' as const;
const SWAP = parseAbi(['function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)']);
const approveCall = { to: CFG.txau, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DESK, 204_402_515_723_270_440n] }) };
const swapCall = { to: DESK, value: '0', data: encodeFunctionData({ abi: SWAP, functionName: 'swap', args: [CFG.txau, CFG.usdc, 204_402_515_723_270_440n, 643_500_000n] }) };
const hashOf = (c: { to: `0x${string}`; data: Hex }) => callHash({ account: ACCOUNT, target: c.to, value: 0n, data: c.data });

let view: Record<string, unknown>;
function rebalanceView(bound: Hex) {
  const tier2 = { account: ACCOUNT, callHash: bound, nonce: '7', expiresAt: '4000000000' };
  const d = digest(praetorDomain(CFG.domainName, CFG.mandateHook), 'Tier2Approval', { ...tier2, nonce: 7n, expiresAt: 4_000_000_000n });
  return { id: 'apr-1', state: 'pending', reason: 'REBALANCE_LIMIT', summary: 'Rebalance: sell 650.00 USD of tXAU for USDC', digest: d, soterChallenge: '', calls: [approveCall, swapCall], tier2 };
}
const api = vi.fn(async (_method: string, path: string) => {
  if (path === '/config') return CFG;
  if (path === '/approvals/apr-1') return view;
  throw new Error(`unexpected ${path}`);
});
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig<typeof import('../lib/api.js')>()), api: (...a: unknown[]) => api(...(a as [string, string])) }));
vi.mock('../lib/passkey.js', () => ({ assertDigest: vi.fn() }));

const { Approve } = await import('./Approve.js');
const show = () => render(<I18nProvider><MemoryRouter initialEntries={['/approve/apr-1']}><Routes><Route path="/approve/:id" element={<Approve />} /></Routes></MemoryRouter></I18nProvider>);

afterEach(() => cleanup());

describe('Approve a rebalance (F4 failures, F6 step 5b)', () => {
  it('shows the swap the approval binds, in words, and lets the owner sign', async () => {
    view = rebalanceView(hashOf(swapCall));
    show();
    expect((await screen.findByTestId('approval-what')).textContent).toBe('Sell 0.2044 tXAU for at least 643.50 USDC');
    expect((screen.getByRole('button', { name: 'Approve with Face ID' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses to sign when the callHash binds none of the calls shown', async () => {
    view = rebalanceView(`0x${'ab'.repeat(32)}`);
    show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve with Face ID' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
