// regulator-service (member: regulator): freezes, sanctions, jurisdictions through the member API (spec 05); the
// console's agent list arrives with M13.
import { startMember } from '@praetor/member-kit';

export function startRegulator(env: Record<string, string | undefined> = process.env) {
  return startMember({ role: 'regulator', env });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRegulator().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
