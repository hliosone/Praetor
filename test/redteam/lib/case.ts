// The red-team case format (spec 08 "Red-team suite", test/redteam/README.md). A case is data: what to send, which
// account it targets, what must stop it and what it must never move. Built-in cases and the held-out cases written
// outside the repo share this schema, so a held-out JSON file runs through the same executors.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REASONS, TIERS } from '@praetor/protocol';

export const CATEGORIES = [
  'prompt-injection', 'limits', 'swaps', 'execution-shape', 'account-bypass', 'consortium', 'approvals', 'payouts', 'frozen', 'mcp', 'web',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Where an attack can be stopped. `model` only for the live driver (the real model declined to act). */
export const LAYERS = [
  'hook', 'validator', 'paymaster', 'bundler', 'agent-signer', 'agent-runner', 'mcp', 'oauth', 'api', 'bank', 'attester', 'executor',
  'usdc', 'safe', 'payout-rail', 'web', 'model',
] as const;
export type Layer = (typeof LAYERS)[number];

export const DRIVERS = ['scripted', 'live'] as const;
export type Driver = (typeof DRIVERS)[number];

/** Protected state an attack must not change (read before and after each attack). */
export const STATE_KEYS = ['policy', 'agent', 'binding', 'status', 'hook', 'owners', 'approvals', 'ownerActions'] as const;
export type StateKey = (typeof STATE_KEYS)[number];

const json = z.record(z.unknown());
const callSpec = z.object({
  to: z.string(),
  value: z.string().optional(),
  data: z.string().optional(),
  fn: z.string().optional(),
  args: z.array(z.unknown()).optional(),
}).refine((c) => (c.data === undefined) !== (c.fn === undefined), 'a call has either data or fn + args');
export type CallSpec = z.infer<typeof callSpec>;

const callDataSpec = z.union([
  z.object({ execute: z.object({ mode: z.string().optional(), calls: z.array(callSpec).min(1), trailing: z.string().optional() }) }),
  z.object({ fn: z.string(), args: z.array(z.unknown()) }),
  z.object({ raw: z.string() }),
]);
export type CallDataSpec = z.infer<typeof callDataSpec>;

const step = z.union([z.object({ tool: z.string(), args: json }), z.object({ text: z.string() })]);

const input = z.discriminatedUnion('kind', [
  /** A chat turn: the scripted driver queues `script` on the fake model first; the live driver sends `message` only. */
  z.object({ kind: z.literal('chat'), message: z.string().min(1).max(4000), script: z.array(step).optional() }),
  /** A userOp signed by the agent key in agent-signer, as a compromised mcp could send it. */
  z.object({ kind: z.literal('agent-op'), callData: callDataSpec }),
  /** A userOp signed by the owner's passkey (software passkey of the fixture account). */
  z.object({ kind: z.literal('owner-op'), callData: callDataSpec, nonceKey: z.enum(['passkey', 'zero']).optional() }),
  /** A plain transaction from a fresh attacker address. */
  z.object({ kind: z.literal('tx'), call: callSpec }),
  /** An HTTP request to a stack service; `session` uses the fixture's signed-in web session. */
  z.object({
    kind: z.literal('http'), method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']), url: z.string(), headers: z.record(z.string()).optional(),
    body: z.unknown().optional(), session: z.boolean().optional(), csrf: z.enum(['valid', 'missing', 'forged']).optional(),
  }),
  /** A consortium attestation signed by the given keys and submitted to the hook by an attacker. */
  z.object({
    kind: z.literal('attestation'), type: z.enum(['StatusAttestation', 'SanctionsAttestation', 'AssetAttestation', 'HeartbeatAttestation']),
    message: json, signers: z.array(z.object({ key: z.string(), domain: z.string().optional(), malleate: z.boolean().optional() })), keepOrder: z.boolean().optional(),
  }),
  /** A named executor of test/redteam/lib/executors.ts for attacks that need more than one request. */
  z.object({ kind: z.literal('custom'), name: z.string(), params: json.default({}) }),
]);
export type Input = z.infer<typeof input>;

const expectation = z.object({
  layer: z.enum(LAYERS),
  reason: z.enum(REASONS).optional(),
  tier: z.enum(TIERS).optional(),
  /** Custom error name or a regular expression over the observed error or detail. */
  error: z.string().optional(),
});
export type Expectation = z.infer<typeof expectation>;

const forbid = z.object({
  /** `any`: no token may leave the account; `non-allowlisted`: only to the mandate's payees, desk or rail, within the hard cap; or these addresses. */
  outflow: z.union([z.enum(['any', 'non-allowlisted', 'none']), z.array(z.string())]).default('any'),
  state: z.array(z.enum(STATE_KEYS)).default([...STATE_KEYS]),
});
export type Forbid = z.infer<typeof forbid>;

export const caseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{1,40}$/, 'id: letters, digits, dot, dash or underscore'),
  category: z.enum(CATEGORIES),
  item: z.number().int().min(1).max(11),
  title: z.string().min(3).max(160),
  /** Account fixture of test/redteam/lib/fixtures.ts the attack targets (`fresh` = a new onboarded account). */
  fixture: z.string().default('main'),
  drivers: z.array(z.enum(DRIVERS)).min(1).default(['scripted']),
  /** Steps run before the snapshot (allowed actions that set the stage, e.g. two payments before a budget attack). */
  setup: z.array(input).default([]),
  input,
  expect: expectation,
  forbid: forbid.default({}),
  /** Foundry tests that prove the same defence at the contract level. */
  foundry: z.array(z.string()).default([]),
  note: z.string().optional(),
  heldout: z.boolean().default(false),
});
export type Case = z.infer<typeof caseSchema>;
export type CaseInput = z.input<typeof caseSchema>;

export function parseCase(raw: unknown, where = 'case'): Case {
  const r = caseSchema.safeParse(raw);
  if (!r.success) throw new Error(`${where}: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** Held-out cases (20% of the suite, written by a teammate and kept outside the repo): every `*.json` file of `dir`. */
export function loadHeldout(dir: string, builtinIds: string[]): Case[] {
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a directory');
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch (e) {
    throw new Error(`REDTEAM_HELDOUT_DIR ${dir}: ${(e as Error).message}`);
  }
  const seen = new Set(builtinIds);
  const out: Case[] = [];
  for (const name of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (e) {
      throw new Error(`${name}: invalid JSON (${(e as Error).message})`);
    }
    for (const [i, item] of (Array.isArray(raw) ? raw : [raw]).entries()) {
      const c = parseCase({ ...(item as object), heldout: true }, Array.isArray(raw) ? `${name}[${i}]` : name);
      if (seen.has(c.id)) throw new Error(`${name}: duplicate case id ${c.id}`);
      seen.add(c.id);
      out.push(c);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
