// Approving a console device's staff passkey (spec 07 console, Q28): the console's "Enrol this device" shows the new
// key; an already enrolled staff member of that member service (here the dev staff passkey) signs the service's
// add-staff challenge over it. CLI: pnpm exec tsx scripts/demo/staff.ts <bank|regulator|operator> '<json from the console>'
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { ensureStaff, http2, stack, staffAssertion, type Role, type Stack } from './lib.js';

export type StaffKey = { credentialId: Hex; x: Hex; y: Hex };

/** The challenge a member service expects for adding a staff key (packages/member-kit StaffAuth.addChallenge). */
export const addStaffChallenge = (k: StaffKey) =>
  keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], ['praetor:add-staff', k.credentialId, BigInt(k.x), BigInt(k.y)]));

export async function approveStaffKey(s: Stack, role: Role, k: StaffKey, label: string): Promise<void> {
  await ensureStaff(s, role);
  const r = await http2(`${s.members[role]}/staff/add`, s.env.INTERNAL_TOKEN_MEMBERS!, { ...k, label, assertion: staffAssertion(s, role, addStaffChallenge(k)) });
  if (r.status !== 204) throw new Error(`staff add ${role}: ${r.status} ${JSON.stringify(r.body)}`);
}

if (process.argv[1]?.endsWith('staff.ts')) {
  const [role, json] = process.argv.slice(2);
  if (!['bank', 'regulator', 'operator'].includes(role ?? '') || !json) throw new Error("usage: staff.ts <bank|regulator|operator> '<json from the console>'");
  await approveStaffKey(stack(), role as Role, JSON.parse(json) as StaffKey, `console-${role}`);
  console.log(`${role}: console key approved`);
}
