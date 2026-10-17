// Regenerates src/abis.generated.ts from contracts/base/out (run `forge build` first).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAbisSource } from '../src/abis.js';

const out = fileURLToPath(new URL('../../../contracts/base/out', import.meta.url));
writeFileSync(new URL('../src/abis.generated.ts', import.meta.url), buildAbisSource(out));
console.log('abis.generated.ts written');
