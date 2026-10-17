// Builds a RIP-7212 precompile input (hash || r || s || x || y) from a fresh software P-256 key.
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const msg = Buffer.from('praetor rip-7212 probe');
const hash = createHash('sha256').update(msg).digest();
const sig = sign('sha256', msg, { key: privateKey, dsaEncoding: 'ieee-p1363' });
const jwk = publicKey.export({ format: 'jwk' });
const hex = (b) => Buffer.from(b).toString('hex');
const good = hash.toString('hex') + hex(sig) + hex(Buffer.from(jwk.x, 'base64url')) + hex(Buffer.from(jwk.y, 'base64url'));
const bad = 'ff' + good.slice(2);
console.log(JSON.stringify({ good: '0x' + good, bad: '0x' + bad }));
