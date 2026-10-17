// The built-in red-team cases (spec 08 minimum set, items 1 to 11). Held-out cases come from REDTEAM_HELDOUT_DIR.
import { parseCase, type Case } from '../lib/case.js';
import { agentCases } from './agent.js';
import { contractCases } from './contracts.js';
import { humanCases } from './humans.js';
import { surfaceCases } from './surfaces.js';
import { globalCases } from './global.js';

export const BUILTIN: Case[] = [...agentCases, ...contractCases, ...humanCases, ...surfaceCases].map((c) => parseCase(c, String(c.id)));
export const GLOBAL: Case[] = globalCases.map((c) => parseCase(c, String(c.id)));
