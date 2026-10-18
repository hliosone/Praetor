// Red-team suite, scripted driver (CI, `make redteam`): the fake model obeys every injection (the worst case), and the
// contract and web cases go straight at the stack. Every case must be stopped where its expectation says.
import { BUILTIN } from '../cases/index.js';
import { redteamSuite } from '../lib/suite.js';

redteamSuite({ name: 'scripted', driver: 'scripted', cases: BUILTIN, pass: ['BLOCKED'] });
