// TS and Solidity twins say the same thing: type strings, enum orders, event and error signatures.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PRIMARY_TYPES, encodeType, REASONS, OWNER_ACTION_KINDS, POLICY_RULES, TIERS, STATUSES, EVENT_SIGNATURES, ERROR_SIGNATURES,
} from '../src/index.js';

const types = readFileSync(new URL('../sol/PraetorTypes.sol', import.meta.url), 'utf8');
const events = readFileSync(new URL('../sol/PraetorEvents.sol', import.meta.url), 'utf8');

const solEnum = (name: string) => {
  const m = types.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!m) throw new Error(`enum ${name} not found`);
  return m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
};

describe('TS and Solidity parity', () => {
  it('declares every TS type string verbatim in PraetorTypes.sol', () => {
    const declared = [...types.matchAll(/string internal constant \w+_TYPE = "([^"]+)";/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual(PRIMARY_TYPES.map(encodeType).sort());
  });

  it('orders the enums identically', () => {
    expect(solEnum('Reason')).toEqual([...REASONS]);
    expect(solEnum('OwnerActionKind')).toEqual([...OWNER_ACTION_KINDS]);
    expect(solEnum('PolicyRule')).toEqual([...POLICY_RULES]);
    expect(solEnum('Tier')).toEqual([...TIERS]);
    expect(solEnum('Status')).toEqual([...STATUSES]);
  });

  it('declares the same events and errors, contract by contract', () => {
    const iface: Record<string, string> = {
      MandateHook: 'IMandateHookEvents', RefusalLog: 'IRefusalLogEvents', StandingOrders: 'IStandingOrdersEvents',
      PayoutRail: 'IPayoutRailEvents', PriceOracle: 'IPriceOracleEvents', TreasuryDesk: 'ITreasuryDeskEvents', Anchor: 'IAnchorEvents',
    };
    for (const [contract, sigs] of Object.entries(EVENT_SIGNATURES)) {
      const body = events.match(new RegExp(`interface ${iface[contract]} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      const declared = [...body.matchAll(/(event|error) ([^;]+);/g)].map((m) => `${m[1]} ${m[2]!.replace(/\s+/g, ' ')}`);
      const expected = [...sigs, ...((ERROR_SIGNATURES as Record<string, readonly string[]>)[contract] ?? [])];
      expect(declared, contract).toEqual(expected);
    }
  });
});
