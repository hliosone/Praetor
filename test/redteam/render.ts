// Re-renders docs/security/redteam.md from the run files under .run/ (after merging runs, or a report format change):
// `pnpm exec tsx test/redteam/render.ts`.
import { writeFileSync } from 'node:fs';
import { root } from '../../scripts/demo/lib.js';
import { readRuns, renderReport } from './lib/report.js';

writeFileSync(`${root}docs/security/redteam.md`, renderReport(readRuns(`${root}.run`)));
console.log('docs/security/redteam.md rendered');
