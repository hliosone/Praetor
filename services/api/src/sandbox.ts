// Judges' sandbox, interim (D48): a disposable account on the main local deployment, onboarded by the page itself with
// a software passkey kept in the browser. The api's only extra power is this faucet: demo USDC minted on the fork,
// once per account and a few times an hour per client. No server key signs anything else for a sandbox button.
import type { Address, Hex } from 'viem';
import { HttpError } from './app.js';

export const SANDBOX_USDC = 5_000_000_000n;
const HOUR_MS = 3_600_000;

export class SandboxFaucet {
  private funded = new Set<string>();
  private byClient = new Map<string, number[]>();

  constructor(private readonly d: {
    enabled: boolean;
    fork: boolean;
    perHour: number;
    mint(to: Address, amount: bigint): Promise<Hex>;
    now?: () => number;
  }) {}

  async fund(account: Address, client: string): Promise<{ txHash: Hex; amount: string }> {
    if (!this.d.enabled) throw new HttpError(404, 'the sandbox is not enabled');
    if (!this.d.fork) throw new HttpError(409, 'the demo faucet exists only on the fork');
    if (this.funded.has(account.toLowerCase())) throw new HttpError(409, 'this sandbox account is already funded');
    const now = this.d.now?.() ?? Date.now();
    const recent = (this.byClient.get(client) ?? []).filter((t) => now - t < HOUR_MS);
    if (recent.length >= this.d.perHour) throw new HttpError(429, 'sandbox rate limit: try again in an hour');
    this.byClient.set(client, [...recent, now]);
    this.funded.add(account.toLowerCase());
    return { txHash: await this.d.mint(account, SANDBOX_USDC), amount: SANDBOX_USDC.toString() };
  }
}
