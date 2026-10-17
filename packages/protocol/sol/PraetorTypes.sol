// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @title PraetorTypes
/// @notice Solidity twin of packages/protocol/src (spec 02): enums, EIP-712 structs and hashes, callHash, policy
/// encoding and validation, owner action payload hashes, audit chain. Frozen once green; any change updates the TS
/// side, the vectors and both test suites in one commit. Compiles for cancun (Base) and paris (FISCO).
library PraetorTypes {
    // The constant chain id of every digest, also on FISCO where block.chainid is 20200.
    uint256 internal constant BASE_CHAIN_ID = 84532;
    uint256 internal constant MAX_AMOUNT = 2 ** 128;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_PAYEES = 16;
    uint256 internal constant MAX_MERCHANTS = 16;
    uint256 internal constant MAX_BANDS = 4;
    uint256 internal constant MAX_DECIMALS = 36;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256("1");

    enum Status { ACTIVE, RESTRICTED, FROZEN }
    enum RiskProfile { NONE, CONSERVATIVE, BALANCED, GROWTH }
    enum AssetKind { TOKEN, DESK, PAYOUT_PARTNER }
    enum AssetStatus { NONE, ACTIVE, SUSPENDED, DELISTED }
    enum Rail { USDC_DIRECT, ALIPAY_PLUS, WECHAT_PAY }
    enum Tier { T0_NEVER, T1_AUTONOMOUS, T2_HUMAN, T3_OWNER, T4_CONSORTIUM }
    enum AuthKind { PASSKEY, SOTER }
    enum PriceSource { PYTH, DEMO }
    enum OwnerActionKind {
        SET_POLICY, ADD_STANDING_ORDER, CANCEL_STANDING_ORDER, LINK_WECHAT, UNLINK_WECHAT, SET_AGENT_KEY,
        REVOKE_AGENT_KEY, PAUSE_AGENT, RESUME_AGENT, SET_OWNER_KEY, CANCEL_RECOVERY, MODULE_CHANGE, REMOVE_PAYEE
    }
    enum Reason {
        OK, FROZEN, RESTRICTED, STALE_STATUS, SESSION_EXPIRED, TARGET_NOT_ALLOWED, SELECTOR_NOT_ALLOWED,
        UNKNOWN_PAYEE, OVER_AUTO_CAP, OVER_HARD_CAP, BUDGET_EXCEEDED, COUNT_EXCEEDED, BAND_BREACH,
        BUFFER_BREACH, TIER2_REQUIRED, TIER2_INVALID, ASSET_NOT_APPROVED, SANCTIONED, JURISDICTION_BLOCKED,
        COUNTERPARTY_NOT_APPROVED, HIDDEN_CALL, REBALANCE_LIMIT, STALE_PRICE, SLIPPAGE, KYA_INVALID,
        NO_POLICY, TIER3_REQUIRED, INVALID_AMOUNT
    }
    /// Policy rule codes in check order (same as POLICY_RULES in TS).
    enum PolicyRule {
        OK, AUTO_CAP_GT_HARD_CAP, DAILY_GT_MONTHLY, AMOUNT_TOO_LARGE, TOO_MANY_PAYEES, TOO_MANY_MERCHANTS,
        BAND_COUNT, USDC_NOT_FIRST, BAND_ORDER, TARGET_SUM, ZERO_ADDRESS, DUPLICATE_PAYEE,
        DUPLICATE_MERCHANT, DUPLICATE_TOKEN, BPS_RANGE, EXPIRED
    }

    struct StatusAttestation { address account; uint8 status; uint64 nonce; uint64 deadline; bytes32 fiscoRef; }
    struct HeartbeatAttestation { uint64 epoch; uint64 validUntil; uint64 deadline; }
    struct CapsAttestation {
        uint8 riskProfile; uint256 perTxCap; uint256 dailyCap; uint256 monthlyCap; uint64 nonce; uint64 deadline; bytes32 fiscoRef;
    }
    struct KYAAttestation {
        address account; address agentKey; bytes32 agentDidHash; bytes32 kycCredentialHash; bytes32 mandateCredentialHash;
        uint8 kycLevel; uint8 riskProfile; bytes2 jurisdiction; bytes32 agentMeasurement; uint64 validUntil; uint64 nonce;
        uint64 deadline; bytes32 fiscoRef;
    }
    struct AssetAttestation {
        address asset; uint8 kind; uint8 status; uint16 maxWeightBps; uint64 nonce; uint64 deadline; bytes32 fiscoRef;
    }
    struct SanctionsAttestation { address target; bool listed; uint64 nonce; uint64 deadline; bytes32 fiscoRef; }
    struct JurisdictionAttestation { bytes2 jurisdiction; bool payoutBlocked; uint64 nonce; uint64 deadline; bytes32 fiscoRef; }
    struct AttesterAttestation { address attester; bytes32 measurement; bool active; uint64 nonce; uint64 deadline; bytes32 fiscoRef; }
    struct AnchorAttestation { uint64 seq; bytes32 head; uint64 fiscoBlock; uint64 deadline; }
    struct Tier2Approval { address account; bytes32 callHash; uint64 nonce; uint64 expiresAt; }
    struct OwnerAction { address account; uint8 action; bytes32 payloadHash; uint64 nonce; uint64 expiresAt; bytes32 fiscoRef; }
    struct SoterApproval { address account; bytes32 digest; bytes32 bindingHash; uint64 soterCounter; uint64 expiresAt; }
    struct StandingOrder {
        address account; uint32 id; address payee; uint256 amount; uint32 period; uint64 firstDue; uint8 rail; bytes32 merchantRef;
    }
    struct OwnerAuth { uint8 kind; bytes data; }

    struct Band { address token; uint16 minBps; uint16 targetBps; uint16 maxBps; }
    struct Policy {
        uint256 autoCap; uint256 hardCap; uint256 dailyBudget; uint256 monthlyBudget; uint16 dailyCount;
        uint256 bufferUsdc;
        address[] payees;
        bytes32[] merchants;
        Band[] bands;
        uint8 maxRebalancesPerDay; uint256 maxTradeUsd; uint16 maxSlippageBps;
        uint64 validUntil;
        bool soterEnabled;
    }

    // Exact type strings of spec 02 (one per line: the parity test reads this file).
    string internal constant STATUS_TYPE = "StatusAttestation(address account,uint8 status,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant HEARTBEAT_TYPE = "HeartbeatAttestation(uint64 epoch,uint64 validUntil,uint64 deadline)";
    string internal constant CAPS_TYPE = "CapsAttestation(uint8 riskProfile,uint256 perTxCap,uint256 dailyCap,uint256 monthlyCap,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant KYA_TYPE = "KYAAttestation(address account,address agentKey,bytes32 agentDidHash,bytes32 kycCredentialHash,bytes32 mandateCredentialHash,uint8 kycLevel,uint8 riskProfile,bytes2 jurisdiction,bytes32 agentMeasurement,uint64 validUntil,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant ASSET_TYPE = "AssetAttestation(address asset,uint8 kind,uint8 status,uint16 maxWeightBps,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant SANCTIONS_TYPE = "SanctionsAttestation(address target,bool listed,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant JURISDICTION_TYPE = "JurisdictionAttestation(bytes2 jurisdiction,bool payoutBlocked,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant ATTESTER_TYPE = "AttesterAttestation(address attester,bytes32 measurement,bool active,uint64 nonce,uint64 deadline,bytes32 fiscoRef)";
    string internal constant ANCHOR_TYPE = "AnchorAttestation(uint64 seq,bytes32 head,uint64 fiscoBlock,uint64 deadline)";
    string internal constant TIER2_TYPE = "Tier2Approval(address account,bytes32 callHash,uint64 nonce,uint64 expiresAt)";
    string internal constant OWNER_ACTION_TYPE = "OwnerAction(address account,uint8 action,bytes32 payloadHash,uint64 nonce,uint64 expiresAt,bytes32 fiscoRef)";
    string internal constant SOTER_TYPE = "SoterApproval(address account,bytes32 digest,bytes32 bindingHash,uint64 soterCounter,uint64 expiresAt)";
    string internal constant STANDING_ORDER_TYPE = "StandingOrder(address account,uint32 id,address payee,uint256 amount,uint32 period,uint64 firstDue,uint8 rail,bytes32 merchantRef)";

    bytes32 internal constant STATUS_TYPEHASH = keccak256(bytes(STATUS_TYPE));
    bytes32 internal constant HEARTBEAT_TYPEHASH = keccak256(bytes(HEARTBEAT_TYPE));
    bytes32 internal constant CAPS_TYPEHASH = keccak256(bytes(CAPS_TYPE));
    bytes32 internal constant KYA_TYPEHASH = keccak256(bytes(KYA_TYPE));
    bytes32 internal constant ASSET_TYPEHASH = keccak256(bytes(ASSET_TYPE));
    bytes32 internal constant SANCTIONS_TYPEHASH = keccak256(bytes(SANCTIONS_TYPE));
    bytes32 internal constant JURISDICTION_TYPEHASH = keccak256(bytes(JURISDICTION_TYPE));
    bytes32 internal constant ATTESTER_TYPEHASH = keccak256(bytes(ATTESTER_TYPE));
    bytes32 internal constant ANCHOR_TYPEHASH = keccak256(bytes(ANCHOR_TYPE));
    bytes32 internal constant TIER2_TYPEHASH = keccak256(bytes(TIER2_TYPE));
    bytes32 internal constant OWNER_ACTION_TYPEHASH = keccak256(bytes(OWNER_ACTION_TYPE));
    bytes32 internal constant SOTER_TYPEHASH = keccak256(bytes(SOTER_TYPE));
    bytes32 internal constant STANDING_ORDER_TYPEHASH = keccak256(bytes(STANDING_ORDER_TYPE));

    function domainSeparator(string memory name, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), DOMAIN_VERSION_HASH, BASE_CHAIN_ID, verifyingContract));
    }

    function digest(bytes32 domainSep, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    function hash(StatusAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(STATUS_TYPEHASH, a.account, a.status, a.nonce, a.deadline, a.fiscoRef));
    }

    function hash(HeartbeatAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(HEARTBEAT_TYPEHASH, a.epoch, a.validUntil, a.deadline));
    }

    function hash(CapsAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(CAPS_TYPEHASH, a.riskProfile, a.perTxCap, a.dailyCap, a.monthlyCap, a.nonce, a.deadline, a.fiscoRef));
    }

    function hash(KYAAttestation memory a) internal pure returns (bytes32) {
        // Split in two encodes: thirteen fields exceed the legacy codegen stack.
        bytes memory head = abi.encode(KYA_TYPEHASH, a.account, a.agentKey, a.agentDidHash, a.kycCredentialHash, a.mandateCredentialHash, a.kycLevel);
        bytes memory tail = abi.encode(a.riskProfile, a.jurisdiction, a.agentMeasurement, a.validUntil, a.nonce, a.deadline, a.fiscoRef);
        return keccak256(bytes.concat(head, tail));
    }

    function hash(AssetAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(ASSET_TYPEHASH, a.asset, a.kind, a.status, a.maxWeightBps, a.nonce, a.deadline, a.fiscoRef));
    }

    function hash(SanctionsAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(SANCTIONS_TYPEHASH, a.target, a.listed, a.nonce, a.deadline, a.fiscoRef));
    }

    function hash(JurisdictionAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(JURISDICTION_TYPEHASH, a.jurisdiction, a.payoutBlocked, a.nonce, a.deadline, a.fiscoRef));
    }

    function hash(AttesterAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(ATTESTER_TYPEHASH, a.attester, a.measurement, a.active, a.nonce, a.deadline, a.fiscoRef));
    }

    function hash(AnchorAttestation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(ANCHOR_TYPEHASH, a.seq, a.head, a.fiscoBlock, a.deadline));
    }

    function hash(Tier2Approval memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(TIER2_TYPEHASH, a.account, a.callHash, a.nonce, a.expiresAt));
    }

    function hash(OwnerAction memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(OWNER_ACTION_TYPEHASH, a.account, a.action, a.payloadHash, a.nonce, a.expiresAt, a.fiscoRef));
    }

    function hash(SoterApproval memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(SOTER_TYPEHASH, a.account, a.digest, a.bindingHash, a.soterCounter, a.expiresAt));
    }

    function hash(StandingOrder memory a) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(STANDING_ORDER_TYPEHASH, a.account, a.id, a.payee, a.amount, a.period, a.firstDue, a.rail, a.merchantRef)
        );
    }

    /// Binds a human approval to one exact call; nonce and expiry live in the approval (spec 02).
    function callHash(address account, address target, uint256 value, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encode(account, BASE_CHAIN_ID, target, value, keccak256(data)));
    }

    /// Inputs are already hashed: raw WeChat and phone identifiers never reach a chain.
    function bindingHash(bytes32 appIdHash, bytes32 openidHash, bytes32 uidHash, bytes32 cpuIdHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(appIdHash, openidHash, uidHash, cpuIdHash));
    }

    function merchantKey(address partner, bytes32 merchantRef) internal pure returns (bytes32) {
        return keccak256(abi.encode(partner, merchantRef));
    }

    function fiscoRef(address fiscoContract, uint256 proposalId) internal pure returns (bytes32) {
        return keccak256(abi.encode(fiscoContract, proposalId));
    }

    /// USD value with 6 decimals. Refuses (ok = false) instead of reverting, so check() never panics (I12).
    function valueUsd6(uint256 amount, uint256 price8, uint8 decimals) internal pure returns (bool ok, uint256 value) {
        // amount <= 2^128 and price8 < 2^128 keep the product below 2^256.
        if (amount > MAX_AMOUNT || price8 >= MAX_AMOUNT || decimals > MAX_DECIMALS) return (false, 0);
        return (true, amount * price8 / 10 ** (uint256(decimals) + 2));
    }

    function policyHash(Policy memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(p));
    }

    /// Same rules and order as validatePolicy in TS; returns a PolicyRule code (0 = OK).
    function validatePolicy(Policy memory p, uint256 nowTs, address usdc) internal pure returns (uint8) {
        if (p.autoCap > p.hardCap) return uint8(PolicyRule.AUTO_CAP_GT_HARD_CAP);
        if (p.dailyBudget > p.monthlyBudget) return uint8(PolicyRule.DAILY_GT_MONTHLY);
        if (
            p.autoCap > MAX_AMOUNT || p.hardCap > MAX_AMOUNT || p.dailyBudget > MAX_AMOUNT || p.monthlyBudget > MAX_AMOUNT
                || p.bufferUsdc > MAX_AMOUNT || p.maxTradeUsd > MAX_AMOUNT
        ) return uint8(PolicyRule.AMOUNT_TOO_LARGE);
        if (p.payees.length > MAX_PAYEES) return uint8(PolicyRule.TOO_MANY_PAYEES);
        if (p.merchants.length > MAX_MERCHANTS) return uint8(PolicyRule.TOO_MANY_MERCHANTS);
        uint256 nb = p.bands.length;
        if (nb == 0 || nb > MAX_BANDS) return uint8(PolicyRule.BAND_COUNT);
        if (p.bands[0].token != usdc) return uint8(PolicyRule.USDC_NOT_FIRST);
        uint256 sum;
        for (uint256 i; i < nb; ++i) {
            Band memory b = p.bands[i];
            if (b.minBps > b.targetBps || b.targetBps > b.maxBps || b.maxBps > BPS) return uint8(PolicyRule.BAND_ORDER);
            sum += b.targetBps;
        }
        if (sum != BPS) return uint8(PolicyRule.TARGET_SUM);
        for (uint256 i; i < p.payees.length; ++i) if (p.payees[i] == address(0)) return uint8(PolicyRule.ZERO_ADDRESS);
        for (uint256 i; i < nb; ++i) if (p.bands[i].token == address(0)) return uint8(PolicyRule.ZERO_ADDRESS);
        for (uint256 i; i < p.payees.length; ++i) {
            for (uint256 k = i + 1; k < p.payees.length; ++k) if (p.payees[i] == p.payees[k]) return uint8(PolicyRule.DUPLICATE_PAYEE);
        }
        for (uint256 i; i < p.merchants.length; ++i) {
            for (uint256 k = i + 1; k < p.merchants.length; ++k) {
                if (p.merchants[i] == p.merchants[k]) return uint8(PolicyRule.DUPLICATE_MERCHANT);
            }
        }
        for (uint256 i; i < nb; ++i) {
            for (uint256 k = i + 1; k < nb; ++k) if (p.bands[i].token == p.bands[k].token) return uint8(PolicyRule.DUPLICATE_TOKEN);
        }
        if (p.maxSlippageBps > BPS) return uint8(PolicyRule.BPS_RANGE);
        if (p.validUntil <= nowTs) return uint8(PolicyRule.EXPIRED);
        return uint8(PolicyRule.OK);
    }

    /// payloadHash of an owner action per the table of spec 02. The hook still checks each payload's own shape.
    function ownerActionPayloadHash(address account, uint8 kind, bytes memory payload) internal pure returns (bytes32) {
        if (kind == uint8(OwnerActionKind.ADD_STANDING_ORDER)) {
            if (payload.length != 256) return keccak256(payload);
            return hash(abi.decode(payload, (StandingOrder)));
        }
        if (kind == uint8(OwnerActionKind.LINK_WECHAT)) {
            if (payload.length < 32) return keccak256(payload);
            bytes32 linkNonce;
            assembly {
                linkNonce := mload(add(payload, 32))
            }
            return keccak256(abi.encode(linkNonce));
        }
        if (kind == uint8(OwnerActionKind.PAUSE_AGENT) || kind == uint8(OwnerActionKind.RESUME_AGENT)) {
            return payload.length == 0 ? bytes32(0) : keccak256(payload);
        }
        if (kind == uint8(OwnerActionKind.MODULE_CHANGE)) return callHash(account, account, 0, payload);
        return keccak256(payload);
    }

    function nextHead(bytes32 prev, bytes32 entryHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(prev, entryHash));
    }
}
