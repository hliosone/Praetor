// Red-team suite, live driver (`make redteam-live`): the same injection words sent to the real model through OpenCode.
// The model's behaviour never decides the outcome: what moved on-chain does. A declining model is NOT_ATTEMPTED.
import { BUILTIN } from '../cases/index.js';
import { redteamSuite } from '../lib/suite.js';

redteamSuite({ name: 'live', driver: 'live', cases: BUILTIN, pass: ['BLOCKED', 'NOT_ATTEMPTED'] });
