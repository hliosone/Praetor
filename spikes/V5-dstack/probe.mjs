// V5 probe: @phala/dstack-sdk@0.5.8 against the dstack simulator, from inside a container.
// Derives the agent key the way spec 05 says (getKey(path, "agent", "secp256k1")), prints only the
// public address (never key material), then asks for a quote bound to keccak256(address || nonce).
import { DstackClient } from '@phala/dstack-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, concat, toHex, bytesToHex, hexToBytes } from 'viem';

const client = new DstackClient(process.env.DSTACK_SIMULATOR_ENDPOINT);
const path = 'praetor/agent/0xabc/v1';

const out = { endpoint: process.env.DSTACK_SIMULATOR_ENDPOINT };
out.reachable = await client.isReachable();
try { out.version = await client.version(); } catch (e) { out.version = `error: ${e.message}`; }

const k1 = await client.getKey(path, 'agent', 'secp256k1');
const k2 = await client.getKey(path, 'agent', 'secp256k1');
out.keyBytes = k1.key.length;
out.signatureChainLength = k1.signature_chain.length;
const address = privateKeyToAccount(bytesToHex(k1.key)).address;
out.address = address;
out.sameKeyTwice = bytesToHex(k1.key) === bytesToHex(k2.key);
const other = await client.getKey('praetor/agent/0xabc/v2', 'agent', 'secp256k1');
out.v2Differs = bytesToHex(other.key) !== bytesToHex(k1.key);

const nonce = toHex(12345n, { size: 32 });
const reportData = keccak256(concat([address, nonce]));
// A hex string is taken as UTF-8 text by getQuote (66 bytes, rejected): pass the 32 raw bytes.
const q = await client.getQuote(hexToBytes(reportData));
out.quote = { quoteHexChars: q.quote.length, reportData: q.report_data, eventLogEntries: JSON.parse(q.event_log).length, vmConfig: q.vm_config ? 'present' : 'absent' };
out.quoteContainsReportData = q.quote.toLowerCase().includes(reportData.slice(2).toLowerCase());
out.replayRtmrs = q.replayRtmrs();

const info = await client.info();
out.info = {
  app_id: info.app_id, instance_id: info.instance_id, app_name: info.app_name, compose_hash: info.compose_hash,
  device_id: info.device_id, key_provider_info: info.key_provider_info, os_image_hash: info.os_image_hash,
  rtmr3: info.tcb_info?.rtmr3, mrtd: info.tcb_info?.mrtd, tcbComposeHash: info.tcb_info?.compose_hash,
};
console.log(JSON.stringify(out, null, 2));
