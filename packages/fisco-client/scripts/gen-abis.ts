// Regenerates src/abis.generated.ts from contracts/fisco/out (run `forge build` there first).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFiscoAbisSource } from '../src/abis.js';

writeFileSync(new URL('../src/abis.generated.ts', import.meta.url), buildFiscoAbisSource(fileURLToPath(new URL('../../../contracts/fisco/out', import.meta.url))));
console.log('fisco abis.generated.ts written');
