import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('docs skeleton (spec 09)', () => {
  const required = [
    'docs/PROGRESS.md', 'docs/DECISIONS.md', 'docs/BLOCKERS.md', 'docs/QUESTIONS.md', 'docs/MANUAL.md',
    'docs/PREEXISTING.md', 'docs/PHASE0.md', 'docs/EVIDENCE.md', 'docs/ARCHITECTURE.md', 'docs/security/README.md',
    'docs/zh-CN/README.md', 'docs/screens/README.md', 'THIRD_PARTY_LICENSES.md', 'NOTICE', 'README.md',
  ];
  for (const f of required) it(`has ${f}`, () => expect(existsSync(root + f)).toBe(true));
});

describe('assistant attribution is off (build prompt, commits)', () => {
  // The assistant's settings are local to the build machine (git-ignored): checked when present, the tracked
  // commit-msg hook below is what enforces the rule on every clone.
  it.runIf(existsSync(root + '.claude/settings.json'))('sets empty commit and PR attribution in the local .claude/settings.json', () => {
    const s = JSON.parse(readFileSync(root + '.claude/settings.json', 'utf8'));
    expect(s.attribution).toMatchObject({ commit: '', pr: '' });
    expect(s.includeCoAuthoredBy).toBe(false);
  });

  it('keeps the assistant instructions and settings out of git', () => {
    const lines = readFileSync(root + '.gitignore', 'utf8').split('\n');
    expect(lines).toEqual(expect.arrayContaining(['CLAUDE.md', '.claude/']));
  });

  it('installs the commit-msg hook from scripts/git-hooks through make setup', () => {
    expect(readFileSync(root + 'Makefile', 'utf8')).toMatch(/git config core\.hooksPath scripts\/git-hooks/);
    expect(existsSync(root + 'scripts/git-hooks/commit-msg')).toBe(true);
  });
});

describe('secrets stay out of git (I10)', () => {
  it('ignores .env and key files', () => {
    const gi = readFileSync(root + '.gitignore', 'utf8');
    for (const p of ['.env', '*.key', '*.pem', '.run/']) expect(gi).toContain(p);
  });

  it('runs gitleaks in make test', () => {
    expect(readFileSync(root + 'Makefile', 'utf8')).toMatch(/^test:.*gitleaks/m);
  });
});
