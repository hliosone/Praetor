// pnpm shock --asset XAU --pct 20: a demo price move (source DEMO) on the local stack (spec 05); the feeder holds it
// for DEMO_HOLD_S and the scheduler wakes the agents whose bands it breaks.
import { parseArgs } from 'node:util';
import { shockPrice, stack } from './lib.js';

const { values } = parseArgs({ options: { asset: { type: 'string', default: 'XAU' }, pct: { type: 'string', default: '20' } } });
const asset = values.asset === 'XAG' ? 'XAG' : 'XAU';
const pct = Number(values.pct);
if (!Number.isFinite(pct) || Math.abs(pct) > 25) throw new Error('--pct must be within 25 (the oracle refuses larger moves)');
const price = await shockPrice(stack(), asset, pct);
console.log(`${asset} set to ${Number(price) / 1e8} (DEMO)`);
