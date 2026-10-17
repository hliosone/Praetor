// pnpm seed: Lin's account on the local stack (spec 00 demo numbers) through the member services, the bundler and
// the relayer, for the milestones before the api (M9). Writes .run/seed.json (public data only).
import { writeFileSync } from 'node:fs';
import { activateSoterAttester, bootstrapConsortium, createAccount, fund, onboard, root, setDemoPrices, stack } from './lib.js';

const s = stack();
await bootstrapConsortium(s);
await setDemoPrices(s);
await activateSoterAttester(s);
const lin = await createAccount(s, process.argv[2] ?? 'lin');
await onboard(s, lin);
await fund(s, lin);
writeFileSync(`${root}.run/seed.json`, JSON.stringify({ account: lin.address, ownerPasskeyLabel: `praetor-demo-owner-${process.argv[2] ?? 'lin'}` }, null, 2));
console.log(`seeded ${lin.address}`);
