import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

type Build = string | { context?: string; dockerfile?: string };
const compose = parse(read('infra/compose.yml'), { merge: true }) as { services: Record<string, { build?: Build }> };

// The Node services: images built from the repository root that install the pnpm workspace.
const nodeDockerfiles = [
  ...new Set(
    Object.values(compose.services).flatMap(({ build }) => {
      if (!build || typeof build === 'string' || build.context !== '..') return [];
      const file = build.dockerfile ?? 'Dockerfile';
      return read(file).includes('pnpm install') ? [file] : [];
    }),
  ),
];
const SYNTAX = 'docker/dockerfile:1.10-labs@sha256:940282bab7a18daad689c238d407ad22393369ad53c6125c9c00f8be8a9da678';
const runtimeUser: Record<string, string> = { 'services/payout-partner/Dockerfile': 'partner' };

type Instruction = { op: string; args: string };
const instructions = (text: string): Instruction[] =>
  text
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [op, ...rest] = l.split(/\s+/);
      return { op: op!.toUpperCase(), args: rest.join(' ') };
    });

const workspaceGlobs = (parse(read('pnpm-workspace.yaml')) as { packages: string[] }).packages;

describe('Node service Dockerfiles (rebuild only what a code change touches)', () => {
  it('covers node-service.Dockerfile and the services with their own Dockerfile', () => {
    expect(nodeDockerfiles.sort()).toEqual([
      'infra/node-service.Dockerfile',
      'services/agent-runner/Dockerfile',
      'services/alipayplus-mock/Dockerfile',
      'services/payout-partner/Dockerfile',
    ]);
  });

  it('pins the Dockerfile syntax (COPY --parents is a labs feature: older built-in frontends reject it)', () => {
    for (const f of nodeDockerfiles) expect(read(f).split('\n')[0], f).toBe(`# syntax=${SYNTAX}`);
  });

  it('keeps large files no image reads out of the root build context (copied into every image otherwise)', () => {
    const di = read('.dockerignore').split('\n').map((l) => l.trim());
    for (const p of ['infra/fisco/downloads', 'contracts/lib']) expect(di).toContain(p);
  });

  for (const file of nodeDockerfiles) {
    describe(file, () => {
      const ins = instructions(read(file));
      const user = runtimeUser[file] ?? 'node';
      const lastIndex = (pred: (i: Instruction) => boolean) => ins.map(pred).lastIndexOf(true);
      const install = lastIndex((i) => i.op === 'RUN' && /\bpnpm install\b/.test(i.args));
      const sources = lastIndex((i) => i.op === 'COPY' && /\s\.\s+\.\/?$/.test(` ${i.args}`));

      it('pins every base image by digest', () => {
        const stages: string[] = [];
        for (const i of ins.filter((x) => x.op === 'FROM')) {
          const [image, , alias] = i.args.split(/\s+/);
          if (!stages.includes(image!)) expect(image, i.args).toMatch(/@sha256:[0-9a-f]{64}$/);
          if (alias) stages.push(alias);
        }
      });

      it('never rewrites the owner of the whole tree (no chown -R over /app)', () => {
        for (const i of ins.filter((x) => x.op === 'RUN')) expect(i.args).not.toMatch(/chown\s+-R\b[^;&|]*\s\/app\b/);
      });

      it(`installs and runs as ${user}, so files are created with the right owner`, () => {
        const users = ins.filter((i) => i.op === 'USER').map((i) => i.args);
        expect(users.at(-1)).toBe(user);
        expect(lastIndex((i) => i.op === 'USER')).toBeLessThan(install);
        expect(ins[sources]!.args).toMatch(new RegExp(`--chown=${user}:${user}\\b`));
      });

      it('installs offline from the workspace manifests alone, before the sources are copied', () => {
        expect(install).toBeGreaterThan(-1);
        expect(ins[install]!.args).toMatch(/--offline\b/);
        expect(ins[install]!.args).toMatch(/--frozen-lockfile\b/);
        expect(sources).toBeGreaterThan(install);
        const manifests = ins.find((i) => i.op === 'COPY' && i.args.includes('--parents'));
        expect(manifests, 'COPY --parents of the manifests').toBeTruthy();
        expect(ins.indexOf(manifests!)).toBeLessThan(install);
        for (const f of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.npmrc']) expect(manifests!.args.split(/\s+/)).toContain(f);
        for (const g of workspaceGlobs) expect(manifests!.args.split(/\s+/)).toContain(`${g}/package.json`);
      });

      it('keeps the pnpm store out of the image (bind-mounted from the store stage)', () => {
        expect(ins[install]!.args).toMatch(/--mount=type=bind,from=store,/);
      });

      it('starts the service with tsx from its own directory', () => {
        expect(ins.filter((i) => i.op === 'CMD').at(-1)?.args).toBe('["node", "--import", "tsx", "src/main.ts"]');
        expect(ins.filter((i) => i.op === 'WORKDIR').at(-1)?.args).toMatch(/^\/app\/services\//);
      });
    });
  }
});
