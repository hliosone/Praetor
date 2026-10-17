import { z } from 'zod';

export function loadSignerConfig(env: Record<string, string | undefined>) {
  const c = z.object({
    PRAETOR_ENV: z.string().default('local'),
    ATTESTATION_MODE: z.enum(['simulator', 'phala']),
    SIGNER_HMAC_MCP: z.string().min(32),
    SIGNER_HMAC_API: z.string().min(32),
    SIGNER_HMAC_BANK: z.string().min(32),
    PUBLIC_URL: z.string().url(),
    DSTACK_ENDPOINT: z.string().default('/var/run/dstack.sock'),
    PORT: z.coerce.number().int().default(3050),
  }).parse(env);
  if (c.PRAETOR_ENV === 'prod' && c.ATTESTATION_MODE === 'simulator') throw new Error('prod refuses simulator attestations (I13)');
  return {
    simulator: c.ATTESTATION_MODE === 'simulator',
    secrets: { mcp: c.SIGNER_HMAC_MCP, api: c.SIGNER_HMAC_API, bank: c.SIGNER_HMAC_BANK },
    mcpUrl: `${c.PUBLIC_URL.replace(/\/$/, '')}/mcp`,
    dstackEndpoint: c.DSTACK_ENDPOINT,
    port: c.PORT,
  };
}
