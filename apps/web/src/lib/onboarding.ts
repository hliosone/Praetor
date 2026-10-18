// Where onboarding resumes (F1): the step follows from what the bank and Base hold for the signed-in account
// (`GET /api/onboarding/progress`), never from this tab's memory, so a reload (iOS Safari discards the tab while the
// KYC page uses the camera) or another tab lands on the right step.
export const STEPS = ['passkey', 'account', 'kyc', 'suitability', 'agent', 'mandate', 'policy'] as const;
export type Step = (typeof STEPS)[number] | 'done';

export type Progress = {
  deployed: boolean;
  /** The bank's KYC record: none, pending, verified (no profile yet), rejected, issued (PersonKYC), revoked. */
  kyc: { state: string; reason?: string };
  riskProfile: string | null;
  /** The agent key of the KYA on Base (the AgentMandate was signed and carried there), or null. */
  kyaAgentKey: `0x${string}` | null;
  /** The agent key installed in the account (SET_AGENT_KEY, not revoked), or null. */
  agentKey: `0x${string}` | null;
  policy: boolean;
};

/** The first step not done yet. A policy on Base means onboarding is over (the agent is managed on /agent). */
export function resumeStep(p: Progress): Step {
  if (p.policy) return 'done';
  if (!p.deployed) return 'account';
  if (p.kyc.state === 'verified') return 'suitability';
  if (p.kyc.state !== 'issued') return 'kyc';
  const kya = p.kyaAgentKey?.toLowerCase();
  if (kya && p.agentKey?.toLowerCase() === kya) return 'policy';
  // The mandate is signed and on Base, the key is not installed yet: only SET_AGENT_KEY is left.
  if (kya) return 'mandate';
  return 'agent';
}
