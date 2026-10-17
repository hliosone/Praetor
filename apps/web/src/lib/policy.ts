// A first policy for a new account (Lin's mandate, spec 00): what the onboarding proposes and the mandate page
// starts from. Amounts in USDC base units as decimal strings, as the api takes them.
export type Config = { chainId: number; domainName: string; mandateHook: `0x${string}`; usdc: `0x${string}`; txau: `0x${string}`; txag: `0x${string}`; deskSpreadBps: number };

export type PolicyJson = {
  autoCap: string; hardCap: string; dailyBudget: string; monthlyBudget: string; dailyCount: number; bufferUsdc: string;
  payees: `0x${string}`[]; merchants: `0x${string}`[];
  bands: { token: `0x${string}`; minBps: number; targetBps: number; maxBps: number }[];
  maxRebalancesPerDay: number; maxTradeUsd: string; maxSlippageBps: number; validUntil: string; soterEnabled: boolean;
};

const usdc = (n: number) => String(BigInt(n) * 1_000_000n);

export function defaultPolicy(c: Config, now = Math.floor(Date.now() / 1000)): PolicyJson {
  return {
    autoCap: usdc(200), hardCap: usdc(2000), dailyBudget: usdc(500), monthlyBudget: usdc(3000), dailyCount: 10, bufferUsdc: usdc(1000),
    payees: [], merchants: [],
    bands: [
      { token: c.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 },
      { token: c.txau, minBps: 2000, targetBps: 3000, maxBps: 3500 },
      { token: c.txag, minBps: 0, targetBps: 1500, maxBps: 1500 },
    ],
    maxRebalancesPerDay: 1, maxTradeUsd: usdc(1000), maxSlippageBps: 100, validUntil: String(now + 365 * 86_400), soterEnabled: true,
  };
}
