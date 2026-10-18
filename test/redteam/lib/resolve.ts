// Placeholders and call encoding for the case format. A case says `$usdc`, `$attacker`, `usdc:2500`, `$now+600` and
// names functions by signature; this module turns that into addresses, amounts and calldata for one environment.
import { concat, encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, isHex, parseAbiItem, type AbiFunction, type AbiParameter, type Address, type Hex } from 'viem';
import type { CallDataSpec, CallSpec } from './case.js';

export type Vars = Record<string, string>;
export type Call = { to: Address; value: bigint; data: Hex };

const zeros = (n: number) => '00'.repeat(n);
/** ERC-7579 execution modes: call type (1 byte) | exec type (1 byte) | unused | selector | payload. */
export const MODES = {
  single: `0x${zeros(32)}`,
  batch: `0x01${zeros(31)}`,
  delegatecall: `0xff${zeros(31)}`,
  'try-single': `0x0001${zeros(30)}`,
  'try-batch': `0x0101${zeros(30)}`,
} as const satisfies Record<string, Hex>;

const CONSTANTS: Record<string, string> = { max256: (2n ** 256n - 1n).toString(), max64: (2n ** 64n - 1n).toString(), zero32: `0x${zeros(32)}` };

function resolveString(s: string, vars: Vars): string {
  if (s.startsWith('usdc:')) {
    const m = /^usdc:(\d{1,15})(?:\.(\d{1,6}))?$/.exec(s);
    if (!m) throw new Error(`bad amount ${s}`);
    return (BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))).toString();
  }
  if (!s.startsWith('$')) return s;
  // A URL may start with a placeholder: $apiUrl/api/me.
  const url = /^\$([A-Za-z][A-Za-z0-9_]*)(\/.*)$/.exec(s);
  if (url) return `${resolveString(`$${url[1]}`, vars)}${url[2]}`;
  const m = /^\$([A-Za-z][A-Za-z0-9_]*)(?:([+-])(\d+))?$/.exec(s);
  const base = m ? (vars[m[1]!] ?? CONSTANTS[m[1]!]) : undefined;
  if (!m || base === undefined) throw new Error(`unknown placeholder ${s}`);
  if (!m[2]) return base;
  const n = BigInt(base) + (m[2] === '+' ? 1n : -1n) * BigInt(m[3]!);
  return n.toString();
}

/** A chat message: every `$name` inside the sentence becomes its value (the model must see real addresses). */
export function interpolate(text: string, vars: Vars): string {
  return text.replace(/\$([A-Za-z][A-Za-z0-9_]*)/g, (whole, name: string) => {
    const v = vars[name] ?? CONSTANTS[name];
    if (v === undefined) throw new Error(`unknown placeholder ${whole}`);
    return v;
  });
}

/** Deep substitution of placeholders in a JSON value; `$now` is the chain time given. */
export function resolveValue(v: unknown, vars: Vars, now: bigint): unknown {
  const all = { ...vars, now: now.toString() };
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return resolveString(x, all);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v);
}

function coerce(p: AbiParameter, v: unknown): unknown {
  if (p.type.endsWith('[]')) {
    if (!Array.isArray(v)) throw new Error(`${p.type} expects an array`);
    return v.map((x) => coerce({ ...p, type: p.type.slice(0, -2) }, x));
  }
  if (/^u?int\d*$/.test(p.type)) return BigInt(String(v));
  if (p.type === 'address') return getAddress(String(v));
  if (p.type === 'bool') return v === true || v === 'true';
  if (p.type.startsWith('bytes') || p.type === 'string') return v;
  throw new Error(`argument type ${p.type} is not supported in a case`);
}

/** `transfer(address,uint256)` + arguments -> calldata. */
export function encodeFn(fn: string, args: unknown[]): Hex {
  const item = parseAbiItem(`function ${fn}`) as AbiFunction;
  if (item.inputs.length !== args.length) throw new Error(`${fn} takes ${item.inputs.length} arguments, got ${args.length}`);
  return encodeFunctionData({ abi: [item], functionName: item.name, args: item.inputs.map((p, i) => coerce(p, args[i])) as never });
}

export function encodeCall(spec: CallSpec, vars: Vars, now: bigint): Call {
  const s = resolveValue(spec, vars, now) as CallSpec;
  const data = s.data !== undefined ? s.data : encodeFn(s.fn!, s.args ?? []);
  if (!isHex(data)) throw new Error(`call data is not hex: ${String(data).slice(0, 20)}`);
  return { to: getAddress(s.to), value: BigInt(s.value ?? '0'), data };
}

const EXECUTIONS = [{ type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'callData', type: 'bytes' }] }] as const;
const EXECUTE = parseAbiItem('function execute(bytes32 mode, bytes executionCalldata)');

/** The account's callData: an ERC-7579 execute (any mode, optional trailing bytes), an account function, or raw bytes. */
export function encodeCallData(spec: CallDataSpec, vars: Vars, now: bigint): Hex {
  if ('raw' in spec) return resolveValue(spec.raw, vars, now) as Hex;
  if ('fn' in spec) return encodeFn(spec.fn, resolveValue(spec.args, vars, now) as unknown[]);
  const calls = spec.execute.calls.map((c) => encodeCall(c, vars, now));
  const name = spec.execute.mode ?? (calls.length === 1 ? 'single' : 'batch');
  const mode = (MODES as Record<string, Hex>)[name] ?? (isHex(name) && name.length === 66 ? name : undefined);
  if (!mode) throw new Error(`unknown execution mode ${name}`);
  const callType = mode.slice(2, 4);
  let exec: Hex;
  if (callType === 'ff') exec = encodePacked(['address', 'bytes'], [calls[0]!.to, calls[0]!.data]);
  else if (callType === '01') exec = encodeAbiParameters(EXECUTIONS, [calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))]);
  else exec = encodePacked(['address', 'uint256', 'bytes'], [calls[0]!.to, calls[0]!.value, calls[0]!.data]);
  if (spec.execute.trailing) exec = concat([exec, resolveValue(spec.execute.trailing, vars, now) as Hex]);
  return encodeFunctionData({ abi: [EXECUTE], functionName: 'execute', args: [mode, exec] });
}
