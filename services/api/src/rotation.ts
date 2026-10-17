// F10 (spec 06): a new agent key is the next key version in agent-signer (praetor/agent/<account>/v<n>). The version
// in use is the one whose address Base holds as the account's agent key; the rest of the rotation is the onboarding's
// own path: quote, agent DID, AgentMandate signed with the passkey, KYA (linked to its predecessor), SET_AGENT_KEY.
import { isAddressEqual, type Address } from 'viem';

const MAX_VERSIONS = 16;
const ZERO = '0x0000000000000000000000000000000000000000';

export class Rotation<T> {
  constructor(private readonly d: {
    agentKeyOf(account: Address): Promise<Address>;
    signerAddress(account: Address, keyVersion: number): Promise<Address>;
    agentCreate(account: Address, keyVersion: number): Promise<T>;
  }) {}

  async rotate(account: Address): Promise<T> {
    const current = await this.d.agentKeyOf(account);
    if (isAddressEqual(current, ZERO)) throw new Error('no agent to rotate on this account');
    for (let v = 1; v < MAX_VERSIONS; v++) {
      if (isAddressEqual(await this.d.signerAddress(account, v), current)) return this.d.agentCreate(account, v + 1);
    }
    throw new Error('the agent key on Base is none of this account\'s key versions');
  }
}
