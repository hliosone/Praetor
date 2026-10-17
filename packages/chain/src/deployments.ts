import { readFileSync } from 'node:fs';
import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a as `0x${string}`);

// infra/deployments/<env>.json written by contracts/base/script/Deploy.s.sol (spec 11: addresses never in env).
export const deploymentSchema = z.object({
  env: z.string(),
  chainId: z.literal(84532),
  domainName: z.string(),
  deployBlock: z.number(),
  forkBlock: z.number().optional(),
  entryPoint: address,
  safe7579Adapter: address,
  safe7579Launchpad: address,
  usdc: address,
  bank: address,
  regulator: address,
  operator: address,
  noOwner: address,
  priceOracle: address,
  mandateHook: address,
  passkeyValidator: address,
  agentKeyValidator: address,
  standingOrders: address,
  identityRegistry: address,
  compliance: address,
  txau: address,
  txag: address,
  treasuryDesk: address,
  payoutRail: address,
  refusalLog: address,
  anchor: address,
  paymaster: address,
  wecrossInbox: address,
  // M12: deployments made before WeCross have no proxy.
  wecrossProxy: address.optional(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export function loadDeployments(path: string): Deployment {
  const r = deploymentSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!r.success) throw new Error(`invalid deployment file ${path}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return r.data;
}
