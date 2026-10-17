// Loads mini program files the way the mini program loads them: CommonJS (`module.exports`), in a fresh JavaScript
// context that has only the ECMAScript built-ins (no TextEncoder, Buffer, crypto or process, which WeChat's app
// service does not promise either).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const MP = new URL('../miniprogram/', import.meta.url);

export function loadIsolated(rel) {
  const code = readFileSync(new URL(rel, MP), 'utf8');
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (name) => { throw new Error(`no require in ${rel}: ${name}`); },
  });
  vm.runInContext(code, context, { filename: rel });
  return module.exports;
}

export const vector = (name) => JSON.parse(readFileSync(new URL(`../../../packages/protocol/vectors/${name}.json`, import.meta.url), 'utf8'));
