# 04 · Consortium chain: FISCO BCOS

## Chain

- FISCO BCOS **v3.17.1**, Air, 4 sealer nodes (bank, regulator, operator, operator-2), group `group0`, chain `chain0`, web3 chainId 20200.
- **Governance (auth) mode** (`build_chain.sh -a <bank admin>`). Bootstrap proposals add regulator and operator as governors (weights 1, participatesRate 51, winRate 51). The FISCO committee governs **the chain only** (deploy auth, governors, node admission): it cannot vote on calls to our contracts, so our app-level 2-of-3 lives in `MemberRegistry`.
- Deploy ACL: Alex found it open in auth mode. Set it explicitly (`setDeployAuthType` whitelist): deployer account + WeIdentity's deployer only.
- Profiles: **non-SM is the main profile** (all gates). **Guomi profile** (`build_chain.sh -s`: SM2 accounts, SM3, SM-TLS) is an extra: in SM mode the EVM's keccak runs as SM3, selectors and topics are SM3, contracts need FISCO's SM solc and SM2-signed transactions, so viem/web3-RPC can't be used. In SM mode: chain + WeIdentity in SM + `MemberRegistry` SM2 binding + our board contracts deployed **with opaque storage** (attestation bytes and signatures stored, no on-chain verification on FISCO) + an SDK smoke test via FISCO's Java SDK (or its Node SM SDK). Base verifies everything in both profiles. Phase 0 (V2) confirms what works.
- Containerised: Phase 0 checks `fiscoorg/fiscobcos:v3.17.1` with `build_chain.sh -d`; fallback: own image from the release binary. web3 RPC on each node, only on the Docker network.
- Field-tested quirks (handled once, in `packages/fisco-client`): legacy tx with `gasPrice: 0`; `eth_getLogs` needs address + topics + explicit `toBlock`, and **returns `[]` unless `toBlock − fromBlock ≤ 9`** (10 blocks inclusive) → chunk, or read from receipts; `block.timestamp` in **ms**; CHAINID 20200 (never used in our digests); solc 0.8.28 deploys; compile with `evm_version = paris`.

Foundry project `contracts/fisco` (paris). Same `PraetorTypes.sol` as Base, with the domain built from constants (`chainId = 84532`, `domainName` and `baseHook` from `MemberRegistry`), so digests are byte-identical to Base (non-SM profile).

## The message board pattern

Every consortium decision is an EIP-712 attestation (02) that lives on FISCO with its member signatures:
1. A member's FISCO account opens a **proposal**: the contract allocates `proposalId` and the next **nonce** (`stored + 1` for that key), and stores the fields. `fiscoRef = keccak256(abi.encode(address(this), proposalId))`.
2. Members (incl. the opener) sign the EIP-712 digest with their Base-signer key off-chain and submit `sign(proposalId, sig)`; the contract verifies the signature (`ecrecover`, non-SM profile) and that the signer is a member.
3. At threshold (tighten 1, loosen 2, bank-only types need the bank), it emits `Ready(type, proposalId, abiEncoded(attestation), sigs)` and calls `BaseOutbox.enqueue`.
4. A proposal whose deadline passed without threshold is closed; its nonce is released (the next proposal reuses it).

## Contracts

### MemberRegistry
```
members[role] = {fiscoAccount, baseSigner, sm2Binding}    role ∈ {BANK, REGULATOR, OPERATOR}
baseHook, domainName                                       settable by 2 of 3 members (own multisig, proposal pattern)
setMember(role, fiscoAccount, baseSigner, bindingSig)      2 of 3 members; bootstrap values set by the deployer once
roleOf(fiscoAccount), baseSignerOf(role)
```
Guomi profile: `sm2Binding` = the member's SM2 signature (its FISCO account) over `"Praetor member binding" ‖ baseSigner`, checked at registration (by the Java SDK service before submission in SM mode), so the secp256k1 key that Base trusts is tied to the SM2 identity on the consortium.

### MandateRegistry
```
openCaps(riskProfile, perTxCap, dailyCap, monthlyCap, deadline) → proposal (bank)
submitPolicy(account, Policy fields, riskProfile)          bank-service on the user's behalf; checks:
    hardCap ≤ caps.perTxCap ; dailyBudget ≤ caps.dailyCap ; monthlyBudget ≤ caps.monthlyCap ;
    every band token ACTIVE in AssetRegistry and maxBps ≤ asset.maxWeightBps
    → MandateChecked(account, policyHash, ok, failedRule)   (its tx hash = the OwnerAction fiscoRef)
openKYA(account, KYA fields, deadline) → proposal (bank)    stores agentDid, agentKey, measurement
linkSuccessor(account, oldAgentDidHash, newAgentDidHash)    bank (F10)
recordOwnerAction(account, action, payloadHash, digest)     bank, after co-signing (audit only, not in the digest)
```

### AgentStatus
```
openStatus(account, status, deadline) → proposal with nonce = stored + 1; any member; account 0 = global
sign(proposalId, sig) ; heartbeat: openHeartbeat(validUntil, deadline) (epoch = stored + 1), 1 sig
statusOf(account), proposal(id)
events: StatusSigned(proposalId, account, status, nonce, signer), Ready(...)
```

### AssetRegistry, SanctionsList, JurisdictionRules, AttesterRegistry
Same proposal pattern and thresholds as 02. Paginated `list()` for the consoles. Seed data (through proposals, in the bootstrap script): assets USDC (TOKEN, ACTIVE, 10000), tXAU (TOKEN, ACTIVE, 3500), tXAG (TOKEN, ACTIVE, 1500), TreasuryDesk (DESK, ACTIVE), "PayLink HK (mock)" (PAYOUT_PARTNER, ACTIVE); sanctions from the OFAC SDN list's Ethereum-format addresses (`infra/seed/ofac-eth-addresses.json` + refresh script) plus one red-team address; jurisdiction CN payoutBlocked.

### AuditLog
```
append(bytes32 entryHash, uint8 kind, address account, bytes32 baseTx, bytes32 refId)   operator-service only
    head = keccak256(abi.encode(head, entryHash)); seq++ ; emit AuditAppended(seq, account, kind, entryHash, head)
openAnchor(seq, head, fiscoBlock, deadline) → proposal; 2 sigs → Ready(Anchor)
headAt(seq), latest()
```
JSON entries live off-chain (operator-service DB, served by the API); anyone can recompute `entryHash` and the chain.

### BaseOutbox
```
enqueue(type, proposalId, payload, sigs)      only the board contracts
pending(from, count) view
markDelivered(id, bytes32 baseTx, uint8 transport)   only the WeCross router account or the relayer account; first write wins
WeCross: enqueue also calls WeCrossHub.interchainInvoke("payment.base.inbox", "deliver", [type, hex(payload‖sigs)], "payment.fisco.outbox", "onDelivered")
onDelivered(bool state, string[] result) returns (string[])    only callable by the FISCO WeCrossProxy
```

## WeIdentity on the same chain

Deployed with WeIdentity Build Tools using Alex's proven versions and configs (`infra/weid/*`, redacted), deployer whitelisted in the deploy ACL. REST service and Java helper only on the Docker network.

## Tests

- Foundry (paris, local EVM): proposal/nonce allocation, every threshold, released nonces, signature parity with Base (same vectors), policy checks against caps, audit chain matches the vector chain.
- Integration on the real 4-node chain (Docker), non-SM: deploy, propose/sign/Ready, getLogs chunking, ms timestamps, governance bootstrap, deploy ACL.
- SM profile smoke: chain up, WeIdentity scenario (as far as it goes, recorded), MemberRegistry binding, board contracts with opaque storage through the Java SDK.
- WeIdentity scenario a–k re-run (Alex's `scenario.sh`): 43 PASS on non-SM.
