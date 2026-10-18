// The agent's key in the account (F1 steps 9 to 13, F10): the AgentMandate signed with the passkey over the bank's
// challenge, the KYA carried to Base by the consortium, then SET_AGENT_KEY for exactly the key this page showed.
import { ownerActionPayload, OwnerActionKind as K } from '@praetor/protocol';
import { api, type Me, type Prepared } from './api.js';
import { assertDigest, signAndSubmit } from './passkey.js';

export type NewAgent = { agentKey: `0x${string}`; measurement: string; simulator: boolean; agentWeId: string; agentDidHash: `0x${string}` };
export type MandateDraft = { draftId: string; challenge: `0x${string}`; claim: Record<string, unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function installAgent(agent: NewAgent, draft: MandateDraft): Promise<void> {
  // The mandate is for the key this page shows (after a rotation, the new one), or the passkey does not sign it.
  if (String(draft.claim.agentKey ?? '').toLowerCase() !== agent.agentKey.toLowerCase()) throw new Error('the mandate draft names another agent key than this page: not signing');
  await api('POST', '/onboarding/kya/sign', { draftId: draft.draftId, challenge: draft.challenge, agentDidHash: agent.agentDidHash, assertion: await assertDigest(draft.challenge) });
  await setAgentKey(agent.agentKey);
}

/** SET_AGENT_KEY for exactly this key once its KYA is on Base: alone, it resumes an onboarding interrupted after the
 *  AgentMandate was signed. */
export async function setAgentKey(agentKey: `0x${string}`): Promise<void> {
  // The KYA reaches Base through the consortium; then the agent key is installed (owner + bank).
  for (let i = 0; i < 90; i++) {
    const a = await api<{ agentKey: string }>('GET', '/agent').catch(() => null);
    if (a?.agentKey?.toLowerCase() === agentKey.toLowerCase()) break;
    await sleep(2000);
  }
  const validUntil = Math.floor(Date.now() / 1000) + 90 * 86_400;
  const { account } = await api<Me>('GET', '/me');
  const p = await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.SET_AGENT_KEY, validUntil });
  const expected = ownerActionPayload({ kind: K.SET_AGENT_KEY, account, agentKey, validUntil }).payload;
  if (!(await signAndSubmit(p, K.SET_AGENT_KEY, expected)).success) throw new Error('the agent key was not installed');
}

/** "Stop my agent": the owner alone revokes the agent key on Base; the bank then revokes its AgentMandate. */
export async function stopAgent(current: `0x${string}`): Promise<boolean> {
  const { account } = await api<Me>('GET', '/me');
  const p = await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.REVOKE_AGENT_KEY });
  return (await signAndSubmit(p, K.REVOKE_AGENT_KEY, ownerActionPayload({ kind: K.REVOKE_AGENT_KEY, account, agentKey: current }).payload)).success;
}

/** A new agent key (the next version in the TEE) and the mandate draft for it, for the owner to review and sign. */
export async function prepareRotation(): Promise<{ agent: NewAgent; draft: MandateDraft }> {
  const agent = await api<NewAgent>('POST', '/agent/rotate');
  return { agent, draft: await api<MandateDraft>('POST', '/onboarding/kya/draft') };
}
